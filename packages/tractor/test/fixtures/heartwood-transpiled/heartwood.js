"use jco";
export function instantiate(getCoreModule, imports, instantiateCore = WebAssembly.instantiate) {
  
  const _debugLog = (...args) => {
    if (!globalThis?.process?.env?.JCO_DEBUG) { return; }
    console.debug(...args);
  }
  const ASYNC_DETERMINISM = 'random';
  
  class GlobalComponentAsyncLowers {
    static map = new Map();
    
    constructor() { throw new Error('GlobalComponentAsyncLowers should not be constructed'); }
    
    static define(args) {
      const { componentIdx, qualifiedImportFn, fn } = args;
      let inner = GlobalComponentAsyncLowers.map.get(componentIdx);
      if (!inner) {
        inner = new Map();
        GlobalComponentAsyncLowers.map.set(componentIdx, inner);
      }
      
      inner.set(qualifiedImportFn, fn);
    }
    
    static lookup(componentIdx, qualifiedImportFn) {
      let inner = GlobalComponentAsyncLowers.map.get(componentIdx);
      if (!inner) {
        inner = new Map();
        GlobalComponentAsyncLowers.map.set(componentIdx, inner);
      }
      
      const found = inner.get(qualifiedImportFn);
      if (found) { return found; }
      
      // In some cases, async lowers are *not* host provided, and
      // but contain/will call an async function in the host.
      //
      // One such case is `stream.write`/`stream.read` trampolines which are
      // actually re-exported through a patch up container *before*
      // they call the relevant async host trampoline.
      //
      // So the path of execution from a component export would be:
      //
      // async guest export --> stream.write import (host wired) -> guest export (patch component) -> async host trampoline
      //
      // On top of all this, the trampoline that is eventually called is async,
      // so we must await the patched guest export call.
      //
      if (qualifiedImportFn.includes("[stream-write-") || qualifiedImportFn.includes("[stream-read-")) {
        return async (...args) => {
          const [originalFn, ...params] = args;
          return await originalFn(...params);
        };
      }
      
      // All other cases can call the registered function directly
      return (...args) => {
        const [originalFn, ...params] = args;
        return originalFn(...params);
      };
    }
  }
  
  class GlobalAsyncParamLowers {
    static map = new Map();
    
    static generateKey(args) {
      const { componentIdx, iface, fnName } = args;
      if (componentIdx === undefined) { throw new TypeError("missing component idx"); }
      if (iface === undefined) { throw new TypeError("missing iface name"); }
      if (fnName === undefined) { throw new TypeError("missing function name"); }
      return `${componentIdx}-${iface}-${fnName}`;
    }
    
    static define(args) {
      const { componentIdx, iface, fnName, fn } = args;
      if (!fn) { throw new TypeError('missing function'); }
      const key = GlobalAsyncParamLowers.generateKey(args);
      GlobalAsyncParamLowers.map.set(key, fn);
    }
    
    static lookup(args) {
      const { componentIdx, iface, fnName } = args;
      const key = GlobalAsyncParamLowers.generateKey(args);
      return GlobalAsyncParamLowers.map.get(key);
    }
  }
  
  class GlobalComponentMemories {
    static map = new Map();
    
    constructor() { throw new Error('GlobalComponentMemories should not be constructed'); }
    
    static save(args) {
      const { idx, componentIdx, memory } = args;
      let inner = GlobalComponentMemories.map.get(componentIdx);
      if (!inner) {
        inner = [];
        GlobalComponentMemories.map.set(componentIdx, inner);
      }
      inner.push({ memory, idx });
    }
    
    static getMemoriesForComponentIdx(componentIdx) {
      const metas = GlobalComponentMemories.map.get(componentIdx);
      return metas.map(meta => meta.memory);
    }
    
    static getMemory(componentIdx, idx) {
      const metas = GlobalComponentMemories.map.get(componentIdx);
      return metas.find(meta => meta.idx === idx)?.memory;
    }
  }
  
  class RepTable {
    #data = [0, null];
    #target;
    
    constructor(args) {
      this.target = args?.target;
    }
    
    insert(val) {
      _debugLog('[RepTable#insert()] args', { val, target: this.target });
      const freeIdx = this.#data[0];
      if (freeIdx === 0) {
        this.#data.push(val);
        this.#data.push(null);
        return (this.#data.length >> 1) - 1;
      }
      this.#data[0] = this.#data[freeIdx << 1];
      const placementIdx = freeIdx << 1;
      this.#data[placementIdx] = val;
      this.#data[placementIdx + 1] = null;
      return freeIdx;
    }
    
    get(rep) {
      _debugLog('[RepTable#get()] args', { rep, target: this.target });
      const baseIdx = rep << 1;
      const val = this.#data[baseIdx];
      return val;
    }
    
    contains(rep) {
      _debugLog('[RepTable#contains()] args', { rep, target: this.target });
      const baseIdx = rep << 1;
      return !!this.#data[baseIdx];
    }
    
    remove(rep) {
      _debugLog('[RepTable#remove()] args', { rep, target: this.target });
      if (this.#data.length === 2) { throw new Error('invalid'); }
      
      const baseIdx = rep << 1;
      const val = this.#data[baseIdx];
      if (val === 0) { throw new Error('invalid resource rep (cannot be 0)'); }
      
      this.#data[baseIdx] = this.#data[0];
      this.#data[0] = rep;
      
      return val;
    }
    
    clear() {
      _debugLog('[RepTable#clear()] args', { rep, target: this.target });
      this.#data = [0, null];
    }
  }
  const _coinFlip = () => { return Math.random() > 0.5; };
  let SCOPE_ID = 0;
  const I32_MIN = -2_147_483_648;
  const I32_MAX = 2_147_483_647;
  const _typeCheckValidI32 = (n) => typeof n === 'number' && n >= I32_MIN && n <= I32_MAX;
  
  const _typeCheckAsyncFn= (f) => {
    return f instanceof ASYNC_FN_CTOR;
  };
  
  const ASYNC_FN_CTOR = (async () => {}).constructor;
  const ASYNC_CURRENT_TASK_IDS = [];
  const ASYNC_CURRENT_COMPONENT_IDXS = [];
  
  function unpackCallbackResult(result) {
    _debugLog('[unpackCallbackResult()] args', { result });
    if (!(_typeCheckValidI32(result))) { throw new Error('invalid callback return value [' + result + '], not a valid i32'); }
    const eventCode = result & 0xF;
    if (eventCode < 0 || eventCode > 3) {
      throw new Error('invalid async return value [' + eventCode + '], outside callback code range');
    }
    if (result < 0 || result >= 2**32) { throw new Error('invalid callback result'); }
    // TODO: table max length check?
    const waitableSetRep = result >> 4;
    return [eventCode, waitableSetRep];
  }
  
  function promiseWithResolvers() {
    if (Promise.withResolvers) {
      return Promise.withResolvers();
    } else {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }
  }
  
  function _prepareCall(
  memoryIdx,
  getMemoryFn,
  startFn,
  returnFn,
  callerInstanceIdx,
  calleeInstanceIdx,
  taskReturnTypeIdx,
  isCalleeAsyncInt,
  stringEncoding,
  resultCountOrAsync,
  ) {
    _debugLog('[_prepareCall()]', {
      callerInstanceIdx,
      calleeInstanceIdx,
      taskReturnTypeIdx,
      isCalleeAsyncInt,
      stringEncoding,
      resultCountOrAsync,
    });
    const argArray = [...arguments];
    
    // Since Rust will happily pass large u32s over, resultCountOrAsync should be one of:
    // (a) u32 max size     => callee is async fn with no result
    // (b) u32 max size - 1 => callee is async fn with result
    // (c) any other value  => callee is sync with the given result count
    //
    // Due to JS handling the value as 2s complement, the `resultCountOrAsync` ends up being:
    // (a) -1 as u32 max size
    // (b) -2 as u32 max size - 1
    // (c) x
    //
    // Due to JS mishandling the value as 2s complement, the actual values we get are:
    // see. https://github.com/wasm-bindgen/wasm-bindgen/issues/1388
    let isAsync = false;
    let hasResultPointer = false;
    if (resultCountOrAsync === -1) {
      isAsync = true;
      hasResultPointer = false;
    } else if (resultCountOrAsync === -2) {
      isAsync = true;
      hasResultPointer = true;
    }
    
    const currentCallerTaskMeta = getCurrentTask(callerInstanceIdx);
    if (!currentCallerTaskMeta) {
      throw new Error('invalid/missing current task for caller during prepare call');
    }
    
    const currentCallerTask = currentCallerTaskMeta.task;
    if (!currentCallerTask) {
      throw new Error('unexpectedly missing task in meta for caller during prepare call');
    }
    
    if (currentCallerTask.componentIdx() !== callerInstanceIdx) {
      throw new Error(`task component idx [${ currentCallerTask.componentIdx() }] !== [${ callerInstanceIdx }] (callee ${ calleeInstanceIdx })`);
    }
    
    let getCalleeParamsFn;
    let resultPtr = null;
    if (hasResultPointer) {
      const directParamsArr = argArray.slice(11);
      getCalleeParamsFn = () => directParamsArr;
      resultPtr = argArray[10];
    } else {
      const directParamsArr = argArray.slice(10);
      getCalleeParamsFn = () => directParamsArr;
    }
    
    let encoding;
    switch (stringEncoding) {
      case 0:
      encoding = 'utf8';
      break;
      case 1:
      encoding = 'utf16';
      break;
      case 2:
      encoding = 'compact-utf16';
      break;
      default:
      throw new Error(`unrecognized string encoding enum [${stringEncoding}]`);
    }
    
    const [newTask, newTaskID] = createNewCurrentTask({
      componentIdx: calleeInstanceIdx,
      isAsync: isCalleeAsyncInt !== 0,
      getCalleeParamsFn,
      // TODO: find a way to pass the import name through here
      entryFnName: 'task/' + currentCallerTask.id() + '/new-prepare-task',
      stringEncoding,
    });
    
    const subtask = currentCallerTask.createSubtask({
      componentIdx: callerInstanceIdx,
      parentTask: currentCallerTask,
      childTask: newTask,
      callMetadata: {
        memory: getMemoryFn(),
        memoryIdx,
        resultPtr,
        returnFn,
        startFn,
      }
    });
    
    newTask.setParentSubtask(subtask);
    // NOTE: This isn't really a return memory idx for the caller, it's for checking
    // against the task.return (which will be called from the callee)
    newTask.setReturnMemoryIdx(memoryIdx);
  }
  
  function _asyncStartCall(args, callee, paramCount, resultCount, flags) {
    const { getCallbackFn, callbackIdx, getPostReturnFn, postReturnIdx } = args;
    _debugLog('[_asyncStartCall()] args', args);
    
    const taskMeta = getCurrentTask(ASYNC_CURRENT_COMPONENT_IDXS.at(-1), ASYNC_CURRENT_TASK_IDS.at(-1));
    if (!taskMeta) { throw new Error('invalid/missing current async task meta during prepare call'); }
    
    const argArray = [...arguments];
    
    // NOTE: at this point we know the current task is the one that was started
    // in PrepareCall, so we *should* be able to pop it back off and be left with
    // the previous task
    const preparedTask = taskMeta.task;
    if (!preparedTask) { throw new Error('unexpectedly missing task in task meta during prepare call'); }
    
    if (resultCount < 0 || resultCount > 1) { throw new Error('invalid/unsupported result count'); }
    
    const callbackFnName = 'callback_' + callbackIdx;
    const callbackFn = getCallbackFn();
    preparedTask.setCallbackFn(callbackFn, callbackFnName);
    preparedTask.setPostReturnFn(getPostReturnFn());
    
    const subtask = preparedTask.getParentSubtask();
    
    if (resultCount < 0 || resultCount > 1) { throw new Error(`unsupported result count [${ resultCount }]`); }
    
    const params = preparedTask.getCalleeParams();
    if (paramCount !== params.length) {
      throw new Error(`unexpected callee param count [${ params.length }], _asyncStartCall invocation expected [${ paramCount }]`);
    }
    
    subtask.setOnProgressFn(() => {
      subtask.setPendingEventFn(() => {
        if (subtask.resolved()) { subtask.deliverResolve(); }
        return {
          code: ASYNC_EVENT_CODE.SUBTASK,
          index: rep,
          result: subtask.getStateNumber(),
        }
      });
    });
    
    const subtaskState = subtask.getStateNumber();
    if (subtaskState < 0 || subtaskState > 2**5) {
      throw new Error('invalid subtask state, out of valid range');
    }
    
    const callerComponentState = getOrCreateAsyncState(subtask.componentIdx());
    const rep = callerComponentState.subtasks.insert(subtask);
    subtask.setRep(rep);
    
    const calleeComponentState = getOrCreateAsyncState(preparedTask.componentIdx());
    const calleeBackpressure = calleeComponentState.hasBackpressure();
    
    // Set up a handler on subtask completion to lower results from the call into the caller's memory region.
    //
    // NOTE: during fused guest->guest calls this handler is triggered, but does not actually perform
    // lowering manually, as fused modules provider helper functions that can
    subtask.registerOnResolveHandler((res) => {
      _debugLog('[_asyncStartCall()] handling subtask result', { res, subtaskID: subtask.id() });
      let subtaskCallMeta = subtask.getCallMetadata();
      
      // NOTE: in the case of guest -> guest async calls, there may be no memory/realloc present,
      // as the host will intermediate the value storage/movement between calls.
      //
      // We can simply take the value and lower it as a parameter
      if (subtaskCallMeta.memory || subtaskCallMeta.realloc) {
        throw new Error("call metadata unexpectedly contains memory/realloc for guest->guest call");
      }
      
      const callerTask = subtask.getParentTask();
      const calleeTask = preparedTask;
      const callerMemoryIdx = callerTask.getReturnMemoryIdx();
      const callerComponentIdx = callerTask.componentIdx();
      
      // If a helper function was provided we are likely in a fused guest->guest call,
      // and the result will be delivered (lift/lowered) via helper function
      if (subtaskCallMeta.returnFn) {
        _debugLog('[_asyncStartCall()] return function present while ahndling subtask result, returning early (skipping lower)');
        return;
      }
      
      // If there is no where to lower the results, exit early
      if (!subtaskCallMeta.resultPtr) {
        _debugLog('[_asyncStartCall()] no result ptr during subtask result handling, returning early (skipping lower)');
        return;
      }
      
      let callerMemory;
      if (callerMemoryIdx) {
        callerMemory = GlobalComponentMemories.getMemory(callerComponentIdx, callerMemoryIdx);
      } else {
        const callerMemories = GlobalComponentMemories.getMemoriesForComponentIdx(callerComponentIdx);
        if (callerMemories.length != 1) { throw new Error(`unsupported amount of caller memories`); }
        callerMemory = callerMemories[0];
      }
      
      if (!callerMemory) {
        throw new Error(`missing memory for to guest->guest call result (subtask [${subtask.id()}])`);
      }
      
      const lowerFns = calleeTask.getReturnLowerFns();
      if (!lowerFns || lowerFns.length === 0) {
        throw new Error(`missing result lower metadata for guest->guests call (subtask [${subtask.id()}])`);
      }
      
      if (lowerFns.length !== 1) {
        throw new Error(`only single result supported for guest->guest calls (subtask [${subtask.id()}])`);
      }
      
      lowerFns[0]({
        realloc: undefined,
        memory: callerMemory,
        vals: [res],
        storagePtr: subtaskCallMeta.resultPtr,
        componentIdx: callerComponentIdx
      });
      
    });
    
    // Build call params
    const subtaskCallMeta = subtask.getCallMetadata();
    let startFnParams = [];
    let calleeParams = [];
    if (subtaskCallMeta.startFn && subtaskCallMeta.resultPtr) {
      // If we're using a fused component start fn  and a result pointer is present,
      // then we need to pass the result pointer and other params to the start fn
      startFnParams.push(subtaskCallMeta.resultPtr, ...params);
    } else {
      // if not we need to pass params to the callee instead
      startFnParams.push(...params);
      calleeParams.push(...params);
    }
    
    preparedTask.registerOnResolveHandler((res) => {
      _debugLog('[_asyncStartCall()] signaling subtask completion due to task completion', {
        childTaskID: preparedTask.id(),
        subtaskID: subtask.id(),
        parentTaskID: subtask.getParentTask().id(),
      });
      subtask.onResolve(res);
    });
    
    // TODO(fix): start fns sometimes produce results, how should they be used?
    // the result should theoretically be used for flat lowering, but fused components do
    // this automatically!
    subtask.onStart({ startFnParams });
    
    _debugLog("[_asyncStartCall()] initial call", {
      task: preparedTask.id(),
      subtaskID: subtask.id(),
      calleeFnName: callee.name,
    });
    
    const callbackResult = callee.apply(null, calleeParams);
    
    _debugLog("[_asyncStartCall()] after initial call", {
      task: preparedTask.id(),
      subtaskID: subtask.id(),
      calleeFnName: callee.name,
    });
    
    const doSubtaskResolve = () => {
      subtask.deliverResolve();
    };
    
    // If a single call resolved the subtask and there is no backpressure in the guest,
    // we can return immediately
    if (subtask.resolved() && !calleeBackpressure) {
      _debugLog("[_asyncStartCall()] instantly resolved", {
        calleeComponentIdx: preparedTask.componentIdx(),
        task: preparedTask.id(),
        subtaskID: subtask.id(),
        callerComponentIdx: subtask.componentIdx(),
      });
      
      // If a fused component return function was specified for the subtask,
      // we've likely already called it during resolution of the task.
      //
      // In this case, we do not want to actually return 2 AKA "RETURNED",
      // but the normal started task state, because the fused component expects to get
      // the waitable + the original subtask state (0 AKA "STARTING")
      //
      if (subtask.getCallMetadata().returnFn) {
        return Number(subtask.waitableRep()) << 4 | subtaskState;
      }
      
      doSubtaskResolve();
      return AsyncSubtask.State.RETURNED;
    }
    
    // Start the (event) driver loop that will resolve the task
    new Promise(async (resolve, reject) => {
      if (subtask.resolved() && calleeBackpressure) {
        await calleeComponentState.waitForBackpressure();
        
        _debugLog("[_asyncStartCall()] instantly resolved after cleared backpressure", {
          calleeComponentIdx: preparedTask.componentIdx(),
          task: preparedTask.id(),
          subtaskID: subtask.id(),
          callerComponentIdx: subtask.componentIdx(),
        });
        return;
      }
      
      const started = await preparedTask.enter();
      if (!started) {
        _debugLog('[_asyncStartCall()] task failed early', {
          taskID: preparedTask.id(),
          subtaskID: subtask.id(),
        });
        throw new Error("task failed to start");
        return;
      }
      
      // TODO: retrieve/pass along actual fn name the callback corresponds to
      // (at least something like `<lifted fn name>_callback`)
      const fnName = [
      '<task ',
      subtask.parentTaskID(),
      '/subtask ',
      subtask.id(),
      '/task ',
      preparedTask.id(),
      '>',
      ].join("");
      
      try {
        _debugLog("[_asyncStartCall()] starting driver loop", { fnName, componentIdx: preparedTask.componentIdx(), });
        await _driverLoop({
          componentState: calleeComponentState,
          task: preparedTask,
          fnName,
          isAsync: true,
          callbackResult,
          resolve,
          reject
        });
      } catch (err) {
        _debugLog("[AsyncStartCall] drive loop call failure", { err });
      }
      
    });
    
    return Number(subtask.waitableRep()) << 4 | subtaskState;
  }
  
  function _syncStartCall(callbackIdx) {
    _debugLog('[_syncStartCall()] args', { callbackIdx });
    throw new Error('synchronous start call not implemented!');
  }
  
  let dv = new DataView(new ArrayBuffer());
  const dataView = mem => dv.buffer === mem.buffer ? dv : dv = new DataView(mem.buffer);
  
  const toUint64 = val => BigInt.asUintN(64, BigInt(val));
  
  function toUint32(val) {
    return val >>> 0;
  }
  const TEXT_DECODER_UTF8 = new TextDecoder();
  const TEXT_ENCODER_UTF8 = new TextEncoder();
  
  function _utf8AllocateAndEncode(s, realloc, memory) {
    if (typeof s !== 'string') {
      throw new TypeError('expected a string, received [' + typeof s + ']');
    }
    if (s.length === 0) { return { ptr: 1, len: 0 }; }
    let buf = TEXT_ENCODER_UTF8.encode(s);
    let ptr = realloc(0, 0, 1, buf.length);
    new Uint8Array(memory.buffer).set(buf, ptr);
    return { ptr, len: buf.length, codepoints: [...s].length };
  }
  
  
  const T_FLAG = 1 << 30;
  
  function rscTableCreateOwn(table, rep) {
    const free = table[0] & ~T_FLAG;
    if (free === 0) {
      table.push(0);
      table.push(rep | T_FLAG);
      return (table.length >> 1) - 1;
    }
    table[0] = table[free << 1];
    table[free << 1] = 0;
    table[(free << 1) + 1] = rep | T_FLAG;
    return free;
  }
  
  function rscTableRemove(table, handle) {
    const scope = table[handle << 1];
    const val = table[(handle << 1) + 1];
    const own = (val & T_FLAG) !== 0;
    const rep = val & ~T_FLAG;
    if (val === 0 || (scope & T_FLAG) !== 0) {
      throw new TypeError("Invalid handle");
    }
    table[handle << 1] = table[0] | T_FLAG;
    table[0] = handle | T_FLAG;
    return { rep, scope, own };
  }
  
  let curResourceBorrows = [];
  
  function getCurrentTask(componentIdx) {
    if (componentIdx === undefined || componentIdx === null) {
      throw new Error('missing/invalid component instance index [' + componentIdx + '] while getting current task');
    }
    const tasks = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx);
    if (tasks === undefined) { return undefined; }
    if (tasks.length === 0) { return undefined; }
    return tasks[tasks.length - 1];
  }
  
  function createNewCurrentTask(args) {
    _debugLog('[createNewCurrentTask()] args', args);
    const {
      componentIdx,
      isAsync,
      entryFnName,
      parentSubtaskID,
      callbackFnName,
      getCallbackFn,
      getParamsFn,
      stringEncoding,
      errHandling,
      getCalleeParamsFn,
      resultPtr,
      callingWasmExport,
    } = args;
    if (componentIdx === undefined || componentIdx === null) {
      throw new Error('missing/invalid component instance index while starting task');
    }
    const taskMetas = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx);
    const callbackFn = getCallbackFn ? getCallbackFn() : null;
    
    const newTask = new AsyncTask({
      componentIdx,
      isAsync,
      entryFnName,
      callbackFn,
      callbackFnName,
      stringEncoding,
      getCalleeParamsFn,
      resultPtr,
      errHandling,
    });
    
    const newTaskID = newTask.id();
    const newTaskMeta = { id: newTaskID, componentIdx, task: newTask };
    
    ASYNC_CURRENT_TASK_IDS.push(newTaskID);
    ASYNC_CURRENT_COMPONENT_IDXS.push(componentIdx);
    
    if (!taskMetas) {
      ASYNC_TASKS_BY_COMPONENT_IDX.set(componentIdx, [newTaskMeta]);
    } else {
      taskMetas.push(newTaskMeta);
    }
    
    return [newTask, newTaskID];
  }
  
  function endCurrentTask(componentIdx, taskID) {
    componentIdx ??= ASYNC_CURRENT_COMPONENT_IDXS.at(-1);
    taskID ??= ASYNC_CURRENT_TASK_IDS.at(-1);
    _debugLog('[endCurrentTask()] args', { componentIdx, taskID });
    
    if (componentIdx === undefined || componentIdx === null) {
      throw new Error('missing/invalid component instance index while ending current task');
    }
    
    const tasks = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx);
    if (!tasks || !Array.isArray(tasks)) {
      throw new Error('missing/invalid tasks for component instance while ending task');
    }
    if (tasks.length == 0) {
      throw new Error('no current task(s) for component instance while ending task');
    }
    
    if (taskID) {
      const last = tasks[tasks.length - 1];
      if (last.id !== taskID) {
        // throw new Error('current task does not match expected task ID');
        return;
      }
    }
    
    ASYNC_CURRENT_TASK_IDS.pop();
    ASYNC_CURRENT_COMPONENT_IDXS.pop();
    
    const taskMeta = tasks.pop();
    return taskMeta.task;
  }
  const ASYNC_TASKS_BY_COMPONENT_IDX = new Map();
  
  class AsyncTask {
    static _ID = 0n;
    
    static State = {
      INITIAL: 'initial',
      CANCELLED: 'cancelled',
      CANCEL_PENDING: 'cancel-pending',
      CANCEL_DELIVERED: 'cancel-delivered',
      RESOLVED: 'resolved',
    }
    
    static BlockResult = {
      CANCELLED: 'block.cancelled',
      NOT_CANCELLED: 'block.not-cancelled',
    }
    
    #id;
    #componentIdx;
    #state;
    #isAsync;
    #entryFnName = null;
    #subtasks = [];
    
    #onResolveHandlers = [];
    #completionPromise = null;
    
    #memoryIdx = null;
    
    #callbackFn = null;
    #callbackFnName = null;
    
    #postReturnFn = null;
    
    #getCalleeParamsFn = null;
    
    #stringEncoding = null;
    
    #parentSubtask = null;
    
    #needsExclusiveLock = false;
    
    #errHandling;
    
    #backpressurePromise;
    #backpressureWaiters = 0n;
    
    #returnLowerFns = null;
    
    cancelled = false;
    requested = false;
    alwaysTaskReturn = false;
    
    returnCalls =  0;
    storage = [0, 0];
    borrowedHandles = {};
    
    awaitableResume = null;
    awaitableCancel = null;
    
    constructor(opts) {
      this.#id = ++AsyncTask._ID;
      
      if (opts?.componentIdx === undefined) {
        throw new TypeError('missing component id during task creation');
      }
      this.#componentIdx = opts.componentIdx;
      
      this.#state = AsyncTask.State.INITIAL;
      this.#isAsync = opts?.isAsync ?? false;
      this.#entryFnName = opts.entryFnName;
      
      const {
        promise: completionPromise,
        resolve: resolveCompletionPromise,
        reject: rejectCompletionPromise,
      } = promiseWithResolvers();
      this.#completionPromise = completionPromise;
      
      this.#onResolveHandlers.push((results) => {
        resolveCompletionPromise(results);
      })
      
      if (opts.callbackFn) { this.#callbackFn = opts.callbackFn; }
      if (opts.callbackFnName) { this.#callbackFnName = opts.callbackFnName; }
      
      if (opts.getCalleeParamsFn) { this.#getCalleeParamsFn = opts.getCalleeParamsFn; }
      
      if (opts.stringEncoding) { this.#stringEncoding = opts.stringEncoding; }
      
      if (opts.parentSubtask) { this.#parentSubtask = opts.parentSubtask; }
      
      this.#needsExclusiveLock = this.isSync() || !this.hasCallback();
      
      if (opts.errHandling) { this.#errHandling = opts.errHandling; }
    }
    
    taskState() { return this.#state; }
    id() { return this.#id; }
    componentIdx() { return this.#componentIdx; }
    isAsync() { return this.#isAsync; }
    entryFnName() { return this.#entryFnName; }
    completionPromise() { return this.#completionPromise; }
    
    isAsync() { return this.#isAsync; }
    isSync() { return !this.isAsync(); }
    
    getErrHandling() { return this.#errHandling; }
    
    hasCallback() { return this.#callbackFn !== null; }
    
    setReturnMemoryIdx(idx) { this.#memoryIdx = idx; }
    getReturnMemoryIdx() { return this.#memoryIdx; }
    
    setReturnLowerFns(fns) { this.#returnLowerFns = fns; }
    getReturnLowerFns() { return this.#returnLowerFns; }
    
    setParentSubtask(subtask) {
      if (!subtask || !(subtask instanceof AsyncSubtask)) { return }
      if (this.#parentSubtask) { throw new Error('parent subtask can only be set once'); }
      this.#parentSubtask = subtask;
    }
    
    getParentSubtask() { return this.#parentSubtask; }
    
    // TODO(threads): this is very inefficient, we can pass along a root task,
    // and ideally do not need this once thread support is in place
    getRootTask() {
      let currentSubtask = this.getParentSubtask();
      let task = this;
      while (currentSubtask) {
        task = currentSubtask.getParentTask();
        currentSubtask = task.getParentSubtask();
      }
      return task;
    }
    
    setPostReturnFn(f) {
      if (!f) { return; }
      if (this.#postReturnFn) { throw new Error('postReturn fn can only be set once'); }
      this.#postReturnFn = f;
    }
    
    setCallbackFn(f, name) {
      if (!f) { return; }
      if (this.#callbackFn) { throw new Error('callback fn can only be set once'); }
      this.#callbackFn = f;
      this.#callbackFnName = name;
    }
    
    getCallbackFnName() {
      if (!this.#callbackFnName) { return undefined; }
      return this.#callbackFnName;
    }
    
    runCallbackFn(...args) {
      if (!this.#callbackFn) { throw new Error('on callback function has been set for task'); }
      return this.#callbackFn.apply(null, args);
    }
    
    getCalleeParams() {
      if (!this.#getCalleeParamsFn) { throw new Error('missing/invalid getCalleeParamsFn'); }
      return this.#getCalleeParamsFn();
    }
    
    mayEnter(task) {
      const cstate = getOrCreateAsyncState(this.#componentIdx);
      if (cstate.hasBackpressure()) {
        _debugLog('[AsyncTask#mayEnter()] disallowed due to backpressure', { taskID: this.#id });
        return false;
      }
      if (!cstate.callingSyncImport()) {
        _debugLog('[AsyncTask#mayEnter()] disallowed due to sync import call', { taskID: this.#id });
        return false;
      }
      const callingSyncExportWithSyncPending = cstate.callingSyncExport && !task.isAsync;
      if (!callingSyncExportWithSyncPending) {
        _debugLog('[AsyncTask#mayEnter()] disallowed due to sync export w/ sync pending', { taskID: this.#id });
        return false;
      }
      return true;
    }
    
    async enter() {
      _debugLog('[AsyncTask#enter()] args', { taskID: this.#id });
      const cstate = getOrCreateAsyncState(this.#componentIdx);
      
      if (this.isSync()) { return true; }
      
      if (cstate.hasBackpressure()) {
        cstate.addBackpressureWaiter();
        
        const result = await this.waitUntil({
          readyFn: () => !cstate.hasBackpressure(),
          cancellable: true,
        });
        
        cstate.removeBackpressureWaiter();
        
        if (result === AsyncTask.BlockResult.CANCELLED) {
          this.cancel();
          return false;
        }
      }
      
      if (this.needsExclusiveLock()) { cstate.exclusiveLock(); }
      
      return true;
    }
    
    isRunning() {
      return this.#state !== AsyncTask.State.RESOLVED;
    }
    
    async waitUntil(opts) {
      const { readyFn, waitableSetRep, cancellable } = opts;
      _debugLog('[AsyncTask#waitUntil()] args', { taskID: this.#id, waitableSetRep, cancellable });
      
      const state = getOrCreateAsyncState(this.#componentIdx);
      const wset = state.waitableSets.get(waitableSetRep);
      
      let event;
      
      wset.incrementNumWaiting();
      
      const keepGoing = await this.suspendUntil({
        readyFn: () => {
          const hasPendingEvent = wset.hasPendingEvent();
          return readyFn() && hasPendingEvent;
        },
        cancellable,
      });
      
      if (keepGoing) {
        event = wset.getPendingEvent();
      } else {
        event = {
          code: ASYNC_EVENT_CODE.TASK_CANCELLED,
          index: 0,
          result: 0,
        };
      }
      
      wset.decrementNumWaiting();
      
      return event;
    }
    
    async onBlock(awaitable) {
      _debugLog('[AsyncTask#onBlock()] args', { taskID: this.#id, awaitable });
      if (!(awaitable instanceof Awaitable)) {
        throw new Error('invalid awaitable during onBlock');
      }
      
      // Build a promise that this task can await on which resolves when it is awoken
      const { promise, resolve, reject } = promiseWithResolvers();
      this.awaitableResume = () => {
        _debugLog('[AsyncTask] resuming after onBlock', { taskID: this.#id });
        resolve();
      };
      this.awaitableCancel = (err) => {
        _debugLog('[AsyncTask] rejecting after onBlock', { taskID: this.#id, err });
        reject(err);
      };
      
      // Park this task/execution to be handled later
      const state = getOrCreateAsyncState(this.#componentIdx);
      state.parkTaskOnAwaitable({ awaitable, task: this });
      
      try {
        await promise;
        return AsyncTask.BlockResult.NOT_CANCELLED;
      } catch (err) {
        // rejection means task cancellation
        return AsyncTask.BlockResult.CANCELLED;
      }
    }
    
    async asyncOnBlock(awaitable) {
      _debugLog('[AsyncTask#asyncOnBlock()] args', { taskID: this.#id, awaitable });
      if (!(awaitable instanceof Awaitable)) {
        throw new Error('invalid awaitable during onBlock');
      }
      // TODO: watch for waitable AND cancellation
      // TODO: if it WAS cancelled:
      // - return true
      // - only once per subtask
      // - do not wait on the scheduler
      // - control flow should go to the subtask (only once)
      // - Once subtask blocks/resolves, reqlinquishControl() will tehn resolve request_cancel_end (without scheduler lock release)
      // - control flow goes back to request_cancel
      //
      // Subtask cancellation should work similarly to an async import call -- runs sync up until
      // the subtask blocks or resolves
      //
      throw new Error('AsyncTask#asyncOnBlock() not yet implemented');
    }
    
    async yieldUntil(opts) {
      const { readyFn, cancellable } = opts;
      _debugLog('[AsyncTask#yieldUntil()] args', { taskID: this.#id, cancellable });
      
      const keepGoing = await this.suspendUntil({ readyFn, cancellable });
      if (!keepGoing) {
        return {
          code: ASYNC_EVENT_CODE.TASK_CANCELLED,
          index: 0,
          result: 0,
        };
      }
      
      return {
        code: ASYNC_EVENT_CODE.NONE,
        index: 0,
        result: 0,
      };
    }
    
    async suspendUntil(opts) {
      const { cancellable, readyFn } = opts;
      _debugLog('[AsyncTask#suspendUntil()] args', { cancellable });
      
      const pendingCancelled = this.deliverPendingCancel({ cancellable });
      if (pendingCancelled) { return false; }
      
      const completed = await this.immediateSuspendUntil({ readyFn, cancellable });
      return completed;
    }
    
    // TODO(threads): equivalent to thread.suspend_until()
    async immediateSuspendUntil(opts) {
      const { cancellable, readyFn } = opts;
      _debugLog('[AsyncTask#immediateSuspendUntil()] args', { cancellable, readyFn });
      
      const ready = readyFn();
      if (ready && !ASYNC_DETERMINISM && _coinFlip()) {
        return true;
      }
      
      const cstate = getOrCreateAsyncState(this.#componentIdx);
      cstate.addPendingTask(this);
      
      const keepGoing = await this.immediateSuspend({ cancellable, readyFn });
      return keepGoing;
    }
    
    async immediateSuspend(opts) { // NOTE: equivalent to thread.suspend()
    // TODO(threads): store readyFn on the thread
    const { cancellable, readyFn } = opts;
    _debugLog('[AsyncTask#immediateSuspend()] args', { cancellable, readyFn });
    
    const pendingCancelled = this.deliverPendingCancel({ cancellable });
    if (pendingCancelled) { return false; }
    
    const cstate = getOrCreateAsyncState(this.#componentIdx);
    
    // TODO(fix): update this to tick until there is no more action to take.
    setTimeout(() => cstate.tick(), 0);
    
    const taskWait = await cstate.suspendTask({ task: this, readyFn });
    const keepGoing = await taskWait;
    return keepGoing;
  }
  
  deliverPendingCancel(opts) {
    const { cancellable } = opts;
    _debugLog('[AsyncTask#deliverPendingCancel()] args', { cancellable });
    
    if (cancellable && this.#state === AsyncTask.State.PENDING_CANCEL) {
      this.#state = Task.State.CANCEL_DELIVERED;
      return true;
    }
    
    return false;
  }
  
  isCancelled() { return this.cancelled }
  
  cancel() {
    _debugLog('[AsyncTask#cancel()] args', { });
    if (!this.taskState() !== AsyncTask.State.CANCEL_DELIVERED) {
      throw new Error(`(component [${this.#componentIdx}]) task [${this.#id}] invalid task state for cancellation`);
    }
    if (this.borrowedHandles.length > 0) { throw new Error('task still has borrow handles'); }
    this.cancelled = true;
    this.onResolve(new Error('cancelled'));
    this.#state = AsyncTask.State.RESOLVED;
  }
  
  onResolve(taskValue) {
    for (const f of this.#onResolveHandlers) {
      try {
        f(taskValue);
      } catch (err) {
        console.error("error during task resolve handler", err);
        throw err;
      }
    }
    
    if (this.#postReturnFn) {
      _debugLog('[AsyncTask#onResolve()] running post return ', {
        componentIdx: this.#componentIdx,
        taskID: this.#id,
      });
      this.#postReturnFn();
    }
  }
  
  registerOnResolveHandler(f) {
    this.#onResolveHandlers.push(f);
  }
  
  resolve(results) {
    _debugLog('[AsyncTask#resolve()] args', {
      results,
      componentIdx: this.#componentIdx,
      taskID: this.#id,
    });
    
    if (this.#state === AsyncTask.State.RESOLVED) {
      throw new Error(`(component [${this.#componentIdx}]) task [${this.#id}]  is already resolved (did you forget to wait for an import?)`);
    }
    if (this.borrowedHandles.length > 0) { throw new Error('task still has borrow handles'); }
    switch (results.length) {
      case 0:
      this.onResolve(undefined);
      break;
      case 1:
      this.onResolve(results[0]);
      break;
      default:
      throw new Error('unexpected number of results');
    }
    this.#state = AsyncTask.State.RESOLVED;
  }
  
  exit() {
    _debugLog('[AsyncTask#exit()] args', { });
    
    // TODO: ensure there is only one task at a time (scheduler.lock() functionality)
    if (this.#state !== AsyncTask.State.RESOLVED) {
      // TODO(fix): only fused, manually specified post returns seem to break this invariant,
      // as the TaskReturn trampoline is not activated it seems.
      //
      // see: test/p3/ported/wasmtime/component-async/post-return.js
      //
      // We *should* be able to upgrade this to be more strict and throw at some point,
      // which may involve rewriting the upstream test to surface task return manually somehow.
      //
      //throw new Error(`(component [${this.#componentIdx}]) task [${this.#id}] exited without resolution`);
      _debugLog('[AsyncTask#exit()] task exited without resolution', {
        componentIdx: this.#componentIdx,
        taskID: this.#id,
        subtask: this.getParentSubtask(),
        subtaskID: this.getParentSubtask()?.id(),
      });
      this.#state = AsyncTask.State.RESOLVED;
    }
    
    if (this.borrowedHandles > 0) {
      throw new Error('task [${this.#id}] exited without clearing borrowed handles');
    }
    
    const state = getOrCreateAsyncState(this.#componentIdx);
    if (!state) { throw new Error('missing async state for component [' + this.#componentIdx + ']'); }
    if (!this.#isAsync && !state.inSyncExportCall) {
      throw new Error('sync task must be run from components known to be in a sync export call');
    }
    state.inSyncExportCall = false;
    
    if (this.needsExclusiveLock() && !state.isExclusivelyLocked()) {
      throw new Error('task [' + this.#id + '] exit: component [' + this.#componentIdx + '] should have been exclusively locked');
    }
    
    state.exclusiveRelease();
  }
  
  needsExclusiveLock() { return this.#needsExclusiveLock; }
  
  createSubtask(args) {
    _debugLog('[AsyncTask#createSubtask()] args', args);
    const { componentIdx, childTask, callMetadata } = args;
    const newSubtask = new AsyncSubtask({
      componentIdx,
      childTask,
      parentTask: this,
      callMetadata,
    });
    this.#subtasks.push(newSubtask);
    return newSubtask;
  }
  
  getLatestSubtask() { return this.#subtasks.at(-1); }
  
  currentSubtask() {
    _debugLog('[AsyncTask#currentSubtask()]');
    if (this.#subtasks.length === 0) { return undefined; }
    return this.#subtasks.at(-1);
  }
  
  endCurrentSubtask() {
    _debugLog('[AsyncTask#endCurrentSubtask()]');
    if (this.#subtasks.length === 0) { throw new Error('cannot end current subtask: no current subtask'); }
    const subtask = this.#subtasks.pop();
    subtask.drop();
    return subtask;
  }
}

function _lowerImport(args, exportFn) {
  const params = [...arguments].slice(2);
  _debugLog('[_lowerImport()] args', { args, params, exportFn });
  const {
    functionIdx,
    componentIdx,
    isAsync,
    paramLiftFns,
    resultLowerFns,
    metadata,
    memoryIdx,
    getMemoryFn,
    getReallocFn,
  } = args;
  
  const parentTaskMeta = getCurrentTask(componentIdx);
  const parentTask = parentTaskMeta?.task;
  if (!parentTask) { throw new Error('missing parent task during lower of import'); }
  
  const cstate = getOrCreateAsyncState(componentIdx);
  
  const subtask = parentTask.createSubtask({
    componentIdx,
    parentTask,
    callMetadata: {
      memoryIdx,
      memory: getMemoryFn(),
      realloc: getReallocFn(),
      resultPtr: params[0],
    }
  });
  parentTask.setReturnMemoryIdx(memoryIdx);
  
  const rep = cstate.subtasks.insert(subtask);
  subtask.setRep(rep);
  
  subtask.setOnProgressFn(() => {
    subtask.setPendingEventFn(() => {
      if (subtask.resolved()) { subtask.deliverResolve(); }
      return {
        code: ASYNC_EVENT_CODE.SUBTASK,
        index: rep,
        result: subtask.getStateNumber(),
      }
    });
  });
  
  // Set up a handler on subtask completion to lower results from the call into the caller's memory region.
  subtask.registerOnResolveHandler((res) => {
    _debugLog('[_lowerImport()] handling subtask result', { res, subtaskID: subtask.id() });
    const { memory, resultPtr, realloc } = subtask.getCallMetadata();
    if (resultLowerFns.length === 0) { return; }
    resultLowerFns[0]({ componentIdx, memory, realloc, vals: [res], storagePtr: resultPtr });
  });
  
  const subtaskState = subtask.getStateNumber();
  if (subtaskState < 0 || subtaskState > 2**5) {
    throw new Error('invalid subtask state, out of valid range');
  }
  
  // NOTE: we must wait a bit before calling the export function,
  // to ensure the subtask state is not modified before the lower call return
  //
  // TODO: we should trigger via subtask state changing, rather than a static wait?
  setTimeout(async () => {
    try {
      _debugLog('[_lowerImport()] calling lowered import', { exportFn, params });
      exportFn.apply(null, params);
      
      const task = subtask.getChildTask();
      task.registerOnResolveHandler((res) => {
        _debugLog('[_lowerImport()] cascading subtask completion', {
          childTaskID: task.id(),
          subtaskID: subtask.id(),
          parentTaskID: parentTask.id(),
        });
        
        subtask.onResolve(res);
        
        cstate.tick();
      });
    } catch (err) {
      console.error("post-lower import fn error:", err);
      throw err;
    }
  }, 100);
  
  return Number(subtask.waitableRep()) << 4 | subtaskState;
}

function _liftFlatU8(ctx) {
  _debugLog('[_liftFlatU8()] args', { ctx });
  let val;
  
  if (ctx.useDirectParams) {
    if (ctx.params.length === 0) { throw new Error('expected at least a single i32 argument'); }
    val = ctx.params[0];
    ctx.params = ctx.params.slice(1);
    return [val, ctx];
  }
  
  if (ctx.storageLen !== undefined && ctx.storageLen < ctx.storagePtr + 1) {
    throw new Error('not enough storage remaining for lift');
  }
  val = new DataView(ctx.memory.buffer).getUint8(ctx.storagePtr, true);
  ctx.storagePtr += 1;
  if (ctx.storageLen !== undefined) { ctx.storageLen -= 1; }
  
  return [val, ctx];
}

function _liftFlatU16(ctx) {
  _debugLog('[_liftFlatU16()] args', { ctx });
  let val;
  
  if (ctx.useDirectParams) {
    if (params.length === 0) { throw new Error('expected at least a single i32 argument'); }
    val = ctx.params[0];
    ctx.params = ctx.params.slice(1);
    return [val, ctx];
  }
  
  if (ctx.storageLen !== undefined && ctx.storageLen < ctx.storagePtr + 2) {
    throw new Error('not enough storage remaining for lift');
  }
  val = new DataView(ctx.memory.buffer).getUint16(ctx.storagePtr, true);
  ctx.storagePtr += 2;
  if (ctx.storageLen !== undefined) { ctx.storageLen -= 2; }
  
  return [val, ctx];
}

function _liftFlatU32(ctx) {
  _debugLog('[_liftFlatU32()] args', { ctx });
  let val;
  
  if (ctx.useDirectParams) {
    if (ctx.params.length === 0) { throw new Error('expected at least a single i34 argument'); }
    val = ctx.params[0];
    ctx.params = ctx.params.slice(1);
    return [val, ctx];
  }
  
  if (ctx.storageLen !== undefined && ctx.storageLen < ctx.storagePtr + 4) {
    throw new Error('not enough storage remaining for lift');
  }
  val = new DataView(ctx.memory.buffer).getUint32(ctx.storagePtr, true);
  ctx.storagePtr += 4;
  if (ctx.storageLen !== undefined) { ctx.storageLen -= 4; }
  
  return [val, ctx];
}

function _liftFlatU64(ctx) {
  _debugLog('[_liftFlatU64()] args', { ctx });
  let val;
  
  if (ctx.useDirectParams) {
    if (ctx.params.length === 0) { throw new Error('expected at least one single i64 argument'); }
    if (typeof ctx.params[0] !== 'bigint') { throw new Error('expected bigint'); }
    val = ctx.params[0];
    ctx.params = ctx.params.slice(1);
    return [val, ctx];
  }
  
  if (ctx.storageLen !== undefined && ctx.storageLen < ctx.storagePtr + 8) {
    throw new Error('not enough storage remaining for lift');
  }
  val = new DataView(ctx.memory.buffer).getUint64(ctx.storagePtr, true);
  ctx.storagePtr += 8;
  if (ctx.storageLen !== undefined) { ctx.storageLen -= 8; }
  
  return [val, ctx];
}

function _liftFlatVariant(casesAndLiftFns) {
  return function _liftFlatVariantInner(ctx) {
    _debugLog('[_liftFlatVariant()] args', { ctx });
    
    const origUseParams = ctx.useDirectParams;
    
    let caseIdx;
    if (casesAndLiftFns.length < 256) {
      let discriminantByteLen = 1;
      const [idx, newCtx] = _liftFlatU8(ctx);
      caseIdx = idx;
      ctx = newCtx;
    } else if (casesAndLiftFns.length > 256 && discriminantByteLen < 65536) {
      discriminantByteLen = 2;
      const [idx, newCtx] = _liftFlatU16(ctx);
      caseIdx = idx;
      ctx = newCtx;
    } else if (casesAndLiftFns.length > 65536 && discriminantByteLen < 4_294_967_296) {
      discriminantByteLen = 4;
      const [idx, newCtx] = _liftFlatU32(ctx);
      caseIdx = idx;
      ctx = newCtx;
    } else {
      throw new Error('unsupported number of cases [' + casesAndLIftFns.legnth + ']');
    }
    
    const [ tag, liftFn, size32, alignment32 ] = casesAndLiftFns[caseIdx];
    
    let val;
    if (liftFn === null) {
      val = { tag };
      return [val, ctx];
    }
    
    const [newVal, newCtx] = liftFn(ctx);
    ctx = newCtx;
    val = { tag, val: newVal };
    
    return [val, ctx];
  }
}

function _liftFlatList(elemLiftFn, alignment32, knownLen) {
  function _liftFlatListInner(ctx) {
    _debugLog('[_liftFlatList()] args', { ctx });
    
    let metaPtr;
    let dataPtr;
    let len;
    if (ctx.useDirectParams) {
      if (knownLen) {
        dataPtr = _liftFlatU32(ctx);
      } else {
        metaPtr = _liftFlatU32(ctx);
      }
    } else {
      if (knownLen) {
        dataPtr = _liftFlatU32(ctx);
      } else {
        metaPtr = _liftFlatU32(ctx);
      }
    }
    
    if (metaPtr) {
      if (dataPtr !== undefined) { throw new Error('both meta and data pointers should not be set yet'); }
      
      if (ctx.useDirectParams) {
        ctx.useDirectParams = false;
        ctx.storagePtr = metaPtr;
        ctx.storageLen = 8;
        
        dataPtr = _liftFlatU32(ctx);
        len = _liftFlatU32(ctx);
        
        ctx.useDirectParams = true;
        ctx.storagePtr = null;
        ctx.storageLen = null;
      } else {
        dataPtr = _liftFlatU32(ctx);
        len = _liftFlatU32(ctx);
      }
    }
    
    const val = [];
    for (var i = 0; i < len; i++) {
      ctx.storagePtr = Math.ceil(ctx.storagePtr / alignment32) * alignment32;
      const [res, nextCtx] = elemLiftFn(ctx);
      val.push(res);
      ctx = nextCtx;
    }
    
    return [val, ctx];
  }
}

function _liftFlatResult(casesAndLiftFns) {
  return function _liftFlatResultInner(ctx) {
    _debugLog('[_liftFlatResult()] args', { ctx });
    return _liftFlatVariant(casesAndLiftFns)(ctx);
  }
}

function _liftFlatBorrow(componentTableIdx, size, memory, vals, storagePtr, storageLen) {
  _debugLog('[_liftFlatBorrow()] args', { size, memory, vals, storagePtr, storageLen });
  throw new Error('flat lift for borrowed resources not yet implemented!');
}

function _lowerFlatU8(ctx) {
  _debugLog('[_lowerFlatU8()] args', ctx);
  const { memory, realloc, vals, storagePtr, storageLen } = ctx;
  if (vals.length !== 1) {
    throw new Error('unexpected number (' + vals.length + ') of core vals (expected 1)');
  }
  if (vals[0] > 255 || vals[0] < 0) { throw new Error('invalid value for core value representing u8'); }
  if (!memory) { throw new Error("missing memory for lower"); }
  new DataView(memory.buffer).setUint32(storagePtr, vals[0], true);
  return 1;
}

function _lowerFlatU16(memory, vals, storagePtr, storageLen) {
  _debugLog('[_lowerFlatU16()] args', { memory, vals, storagePtr, storageLen });
  if (vals.length !== 1) {
    throw new Error('unexpected number (' + vals.length + ') of core vals (expected 1)');
  }
  if (vals[0] > 65_535 || vals[0] < 0) { throw new Error('invalid value for core value representing u16'); }
  new DataView(memory.buffer).setUint16(storagePtr, vals[0], true);
  return 2;
}

function _lowerFlatU32(ctx) {
  _debugLog('[_lowerFlatU32()] args', { ctx });
  const { memory, realloc, vals, storagePtr, storageLen } = ctx;
  if (vals.length !== 1) { throw new Error('expected single value to lower, got (' + vals.length + ')'); }
  if (vals[0] > 4_294_967_295 || vals[0] < 0) { throw new Error('invalid value for core value representing u32'); }
  
  // TODO(refactor): fail loudly on misaligned flat lowers?
  const rem = ctx.storagePtr % 4;
  if (rem !== 0) { ctx.storagePtr += (4 - rem); }
  
  new DataView(memory.buffer).setUint32(storagePtr, vals[0], true);
  
  return 4;
}

function _lowerFlatU64(memory, vals, storagePtr, storageLen) {
  _debugLog('[_lowerFlatU64()] args', { memory, vals, storagePtr, storageLen });
  if (vals.length !== 1) { throw new Error('unexpected number of core vals'); }
  if (vals[0] > 18_446_744_073_709_551_615n || vals[0] < 0n) { throw new Error('invalid value for core value representing u64'); }
  new DataView(memory.buffer).setBigUint64(storagePtr, vals[0], true);
  return 8;
}

function _lowerFlatRecord(fieldMetas) {
  return (size, memory, vals, storagePtr, storageLen) => {
    const params = [...arguments].slice(5);
    _debugLog('[_lowerFlatRecord()] args', {
      size,
      memory,
      vals,
      storagePtr,
      storageLen,
      params,
      fieldMetas
    });
    
    const [start] = vals;
    if (storageLen !== undefined && size !== undefined && size > storageLen) {
      throw new Error('not enough storage remaining for record flat lower');
    }
    const data = new Uint8Array(memory.buffer, start, size);
    new Uint8Array(memory.buffer, storagePtr, size).set(data);
    return data.byteLength;
  }
}

function _lowerFlatVariant(metadata, extra) {
  const { discriminantSizeBytes, lowerMetas } = metadata;
  
  return function _lowerFlatVariantInner(ctx) {
    _debugLog('[_lowerFlatVariant()] args', ctx);
    const { memory, realloc, vals, storageLen, componentIdx } = ctx;
    let storagePtr = ctx.storagePtr;
    
    const { tag, val } = vals[0];
    const variant = lowerMetas.find(vm => vm.tag === tag);
    if (!variant) { throw new Error(`missing/invalid variant, no tag matches [${tag}] (options were ${variantMetas.map(vm => vm.tag)})`); }
    if (!variant.discriminant) { throw new Error(`missing/invalid discriminant for variant [${variant}]`); }
    
    let bytesWritten;
    let discriminantLowerArgs = { memory, realloc, vals: [variant.discriminant], storagePtr, componentIdx }
    switch (discriminantSizeBytes) {
      case 1:
      bytesWritten = _lowerFlatU8(discriminantLowerArgs);
      break;
      case 2:
      bytesWritten = _lowerFlatU16(discriminantLowerArgs);
      break;
      case 4:
      bytesWritten = _lowerFlatU32(discriminantLowerArgs);
      break;
      default:
      throw new Error(`unexpected discriminant size bytes [${discriminantSizeBytes}]`);
    }
    if (bytesWritten !== discriminantSizeBytes) {
      throw new Error("unexpectedly wrote more bytes than discriminant");
    }
    storagePtr += bytesWritten;
    
    bytesWritten += variant.lowerFn({ memory, realloc, vals: [val], storagePtr, storageLen, componentIdx });
    
    return bytesWritten;
  }
}

function _lowerFlatList(args) {
  const { elemLowerFn } = args;
  if (!elemLowerFn) { throw new TypeError("missing/invalid element lower fn for list"); }
  
  return function _lowerFlatListInner(ctx) {
    _debugLog('[_lowerFlatList()] args', { ctx });
    
    if (ctx.params.length < 2) { throw new Error('insufficient params left to lower list'); }
    const storagePtr = ctx.params[0];
    const elemCount = ctx.params[1];
    ctx.params = ctx.params.slice(2);
    
    if (ctx.useDirectParams) {
      const list = ctx.vals[0];
      if (!list) { throw new Error("missing direct param value"); }
      
      const elemLowerCtx = { storagePtr, memory: ctx.memory };
      for (let idx = 0; idx < list.length; idx++) {
        elemLowerCtx.vals = list.slice(idx, idx+1);
        elemLowerCtx.storagePtr += elemLowerFn(elemLowerCtx);
      }
      
      const bytesLowered = elemLowerCtx.storagePtr - ctx.storagePtr;
      ctx.storagePtr = elemLowerCtx.storagePtr;
      return bytesLowered;
    }
    
    
    if (ctx.vals.length !== 2) {
      throw new Error('indirect parameter loading must have a pointer and length as vals');
    }
    let [valStartPtr, valLen] = ctx.vals;
    const totalSizeBytes = valLen * size;
    if (ctx.storageLen !== undefined && totalSizeBytes > ctx.storageLen) {
      throw new Error('not enough storage remaining for list flat lower');
    }
    
    const data = new Uint8Array(memory.buffer, valStartPtr, totalSizeBytes);
    new Uint8Array(memory.buffer, storagePtr, totalSizeBytes).set(data);
    
    return totalSizeBytes;
  }
}

function _lowerFlatTuple(size, memory, vals, storagePtr, storageLen) {
  _debugLog('[_lowerFlatTuple()] args', { size, memory, vals, storagePtr, storageLen });
  let [start, len] = vals;
  if (storageLen !== undefined && len > storageLen) {
    throw new Error('not enough storage remaining for tuple flat lower');
  }
  const data = new Uint8Array(memory.buffer, start, len);
  new Uint8Array(memory.buffer, storagePtr, len).set(data);
  return data.byteLength;
}

function _lowerFlatEnum(size, memory, vals, storagePtr, storageLen) {
  _debugLog('[_lowerFlatEnum()] args', { size, memory, vals, storagePtr, storageLen });
  let [start] = vals;
  if (storageLen !== undefined && size !== undefined && size > storageLen) {
    throw new Error('not enough storage remaining for enum flat lower');
  }
  const data = new Uint8Array(memory.buffer, start, size);
  new Uint8Array(memory.buffer, storagePtr, size).set(data);
  return data.byteLength;
}

function _lowerFlatOption(size, memory, vals, storagePtr, storageLen) {
  _debugLog('[_lowerFlatOption()] args', { size, memory, vals, storagePtr, storageLen });
  let [start] = vals;
  if (storageLen !== undefined && size !== undefined && size > storageLen) {
    throw new Error('not enough storage remaining for option flat lower');
  }
  const data = new Uint8Array(memory.buffer, start, size);
  new Uint8Array(memory.buffer, storagePtr, size).set(data);
  return data.byteLength;
}

function _lowerFlatResult(lowerMetas) {
  const invalidTag = lowerMetas.find(t => t.tag !== 'ok' && t.tag !== 'error')
  if (invalidTag) { throw new Error(`invalid variant tag [${invalidTag}] found for result`); }
  
  return function _lowerFlatResultInner() {
    _debugLog('[_lowerFlatResult()] args', { lowerMetas });
    let lowerFn = _lowerFlatVariant({ discriminantSizeBytes: 1, lowerMetas }, { forResult: true });
    return lowerFn.apply(null, arguments);
  };
}

function _lowerFlatOwn(size, memory, vals, storagePtr, storageLen) {
  _debugLog('[_lowerFlatOwn()] args', { size, memory, vals, storagePtr, storageLen });
  throw new Error('flat lower for owned resources not yet implemented!');
}
const ASYNC_STATE = new Map();

function getOrCreateAsyncState(componentIdx, init) {
  if (!ASYNC_STATE.has(componentIdx)) {
    const newState = new ComponentAsyncState({ componentIdx });
    ASYNC_STATE.set(componentIdx, newState);
  }
  return ASYNC_STATE.get(componentIdx);
}

class ComponentAsyncState {
  static EVENT_HANDLER_EVENTS = [ 'backpressure-change' ];
  
  #componentIdx;
  #callingAsyncImport = false;
  #syncImportWait = promiseWithResolvers();
  #locked = false;
  #parkedTasks = new Map();
  #suspendedTasksByTaskID = new Map();
  #suspendedTaskIDs = [];
  #pendingTasks = [];
  #errored = null;
  
  #backpressure = 0;
  #backpressureWaiters = 0n;
  
  #handlerMap = new Map();
  #nextHandlerID = 0n;
  
  mayLeave = true;
  
  #streams;
  
  waitableSets;
  waitables;
  subtasks;
  
  constructor(args) {
    this.#componentIdx = args.componentIdx;
    this.waitableSets = new RepTable({ target: `component [${this.#componentIdx}] waitable sets` });
    this.waitables = new RepTable({ target: `component [${this.#componentIdx}] waitables` });
    this.subtasks = new RepTable({ target: `component [${this.#componentIdx}] subtasks` });
    this.#streams = new Map();
  };
  
  componentIdx() { return this.#componentIdx; }
  streams() { return this.#streams; }
  
  errored() { return this.#errored !== null; }
  setErrored(err) {
    _debugLog('[ComponentAsyncState#setErrored()] component errored', { err, componentIdx: this.#componentIdx });
    if (this.#errored) { return; }
    if (!err) {
      err = new Error('error elswehere (see other component instance error)')
      err.componentIdx = this.#componentIdx;
    }
    this.#errored = err;
  }
  
  callingSyncImport(val) {
    if (val === undefined) { return this.#callingAsyncImport; }
    if (typeof val !== 'boolean') { throw new TypeError('invalid setting for async import'); }
    const prev = this.#callingAsyncImport;
    this.#callingAsyncImport = val;
    if (prev === true && this.#callingAsyncImport === false) {
      this.#notifySyncImportEnd();
    }
  }
  
  #notifySyncImportEnd() {
    const existing = this.#syncImportWait;
    this.#syncImportWait = promiseWithResolvers();
    existing.resolve();
  }
  
  async waitForSyncImportCallEnd() {
    await this.#syncImportWait.promise;
  }
  
  setBackpressure(v) { this.#backpressure = v; }
  getBackpressure(v) { return this.#backpressure; }
  incrementBackpressure() {
    const newValue = this.getBackpressure() + 1;
    if (newValue > 2**16) { throw new Error("invalid backpressure value, overflow"); }
    this.setBackpressure(newValue);
  }
  decrementBackpressure() {
    this.setBackpressure(Math.max(0, this.getBackpressure() - 1));
  }
  hasBackpressure() { return this.#backpressure > 0; }
  
  waitForBackpressure() {
    let backpressureCleared = false;
    const cstate = this;
    cstate.addBackpressureWaiter();
    const handlerID = this.registerHandler({
      event: 'backpressure-change',
      fn: (bp) => {
        if (bp === 0) {
          cstate.removeHandler(handlerID);
          backpressureCleared = true;
        }
      }
    });
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (backpressureCleared) { return; }
        clearInterval(interval);
        cstate.removeBackpressureWaiter();
        resolve(null);
      }, 0);
    });
  }
  
  registerHandler(args) {
    const { event, fn } = args;
    if (!event) { throw new Error("missing handler event"); }
    if (!fn) { throw new Error("missing handler fn"); }
    
    if (!ComponentAsyncState.EVENT_HANDLER_EVENTS.includes(event)) {
      throw new Error(`unrecognized event handler [${event}]`);
    }
    
    const handlerID = this.#nextHandlerID++;
    let handlers = this.#handlerMap.get(event);
    if (!handlers) {
      handlers = [];
      this.#handlerMap.set(event, handlers)
    }
    
    handlers.push({ id: handlerID, fn, event });
    return handlerID;
  }
  
  removeHandler(args) {
    const { event, handlerID } = args;
    const registeredHandlers = this.#handlerMap.get(event);
    if (!registeredHandlers) { return; }
    const found = registeredHandlers.find(h => h.id === handlerID);
    if (!found) { return; }
    this.#handlerMap.set(event, this.#handlerMap.get(event).filter(h => h.id !== handlerID));
  }
  
  getBackpressureWaiters() { return this.#backpressureWaiters; }
  addBackpressureWaiter() { this.#backpressureWaiters++; }
  removeBackpressureWaiter() {
    this.#backpressureWaiters--;
    if (this.#backpressureWaiters < 0) {
      throw new Error("unexepctedly negative number of backpressure waiters");
    }
  }
  
  parkTaskOnAwaitable(args) {
    if (!args.awaitable) { throw new TypeError('missing awaitable when trying to park'); }
    if (!args.task) { throw new TypeError('missing task when trying to park'); }
    const { awaitable, task } = args;
    
    let taskList = this.#parkedTasks.get(awaitable.id());
    if (!taskList) {
      taskList = [];
      this.#parkedTasks.set(awaitable.id(), taskList);
    }
    taskList.push(task);
    
    this.wakeNextTaskForAwaitable(awaitable);
  }
  
  wakeNextTaskForAwaitable(awaitable) {
    if (!awaitable) { throw new TypeError('missing awaitable when waking next task'); }
    const awaitableID = awaitable.id();
    
    const taskList = this.#parkedTasks.get(awaitableID);
    if (!taskList || taskList.length === 0) {
      _debugLog('[ComponentAsyncState] no tasks waiting for awaitable', { awaitableID: awaitable.id() });
      return;
    }
    
    let task = taskList.shift(); // todo(perf)
    if (!task) { throw new Error('no task in parked list despite previous check'); }
    
    if (!task.awaitableResume) {
      throw new Error('task ready due to awaitable is missing resume', { taskID: task.id(), awaitableID });
    }
    task.awaitableResume();
  }
  
  // TODO: we might want to check for pre-locked status here
  exclusiveLock() {
    this.#locked = true;
  }
  
  exclusiveRelease() {
    _debugLog('[ComponentAsyncState#exclusiveRelease()] releasing', {
      locked: this.#locked,
      componentIdx: this.#componentIdx,
    });
    
    this.#locked = false
  }
  
  isExclusivelyLocked() { return this.#locked === true; }
  
  #getSuspendedTaskMeta(taskID) {
    return this.#suspendedTasksByTaskID.get(taskID);
  }
  
  #removeSuspendedTaskMeta(taskID) {
    _debugLog('[ComponentAsyncState#removeSuspendedTaskMeta()] removing suspended task', { taskID });
    const idx = this.#suspendedTaskIDs.findIndex(t => t === taskID);
    const meta = this.#suspendedTasksByTaskID.get(taskID);
    this.#suspendedTaskIDs[idx] = null;
    this.#suspendedTasksByTaskID.delete(taskID);
    return meta;
  }
  
  #addSuspendedTaskMeta(meta) {
    if (!meta) { throw new Error('missing task meta'); }
    const taskID = meta.taskID;
    this.#suspendedTasksByTaskID.set(taskID, meta);
    this.#suspendedTaskIDs.push(taskID);
    if (this.#suspendedTasksByTaskID.size < this.#suspendedTaskIDs.length - 10) {
      this.#suspendedTaskIDs = this.#suspendedTaskIDs.filter(t => t !== null);
    }
  }
  
  suspendTask(args) {
    // TODO(threads): readyFn is normally on the thread
    const { task, readyFn } = args;
    const taskID = task.id();
    _debugLog('[ComponentAsyncState#suspendTask()]', { taskID });
    
    if (this.#getSuspendedTaskMeta(taskID)) {
      throw new Error('task [' + taskID + '] already suspended');
    }
    
    const { promise, resolve } = Promise.withResolvers();
    this.#addSuspendedTaskMeta({
      task,
      taskID,
      readyFn,
      resume: () => {
        _debugLog('[ComponentAsyncState#suspendTask()] resuming suspended task', { taskID });
        // TODO(threads): it's thread cancellation we should be checking for below, not task
        resolve(!task.isCancelled());
      },
    });
    
    return promise;
  }
  
  resumeTaskByID(taskID) {
    const meta = this.#removeSuspendedTaskMeta(taskID);
    if (!meta) { return; }
    if (meta.taskID !== taskID) { throw new Error('task ID does not match'); }
    meta.resume();
  }
  
  tick() {
    _debugLog('[ComponentAsyncState#tick()]', { suspendedTaskIDs: this.#suspendedTaskIDs });
    const resumableTasks = this.#suspendedTaskIDs.filter(t => t !== null);
    for (const taskID of resumableTasks) {
      const meta = this.#suspendedTasksByTaskID.get(taskID);
      if (!meta || !meta.readyFn) {
        throw new Error(`missing/invalid task despite ID [${taskID}] being present`);
      }
      
      const isReady = meta.readyFn();
      if (!isReady) { continue; }
      
      this.resumeTaskByID(taskID);
    }
    
    return this.#suspendedTaskIDs.filter(t => t !== null).length === 0;
  }
  
  addPendingTask(task) {
    this.#pendingTasks.push(task);
  }
  
  addStreamEnd(args) {
    _debugLog('[ComponentAsyncState#addStreamEnd()] args', args);
    const { tableIdx, streamEnd } = args;
    
    let tbl = this.#streams.get(tableIdx);
    if (!tbl) {
      tbl = new RepTable({ target: `component [${this.#componentIdx}] streams` });
      this.#streams.set(tableIdx, tbl);
    }
    
    const streamIdx = tbl.insert(streamEnd);
    return streamIdx;
  }
  
  createStream(args) {
    _debugLog('[ComponentAsyncState#createStream()] args', args);
    const { tableIdx, elemMeta } = args;
    if (tableIdx === undefined) { throw new Error("missing table idx while adding stream"); }
    if (elemMeta === undefined) { throw new Error("missing element metadata while adding stream"); }
    
    let tbl = this.#streams.get(tableIdx);
    if (!tbl) {
      tbl = new RepTable({ target: `component [${this.#componentIdx}] streams` });
      this.#streams.set(tableIdx, tbl);
    }
    
    const stream = new InternalStream({
      tableIdx,
      componentIdx: this.#componentIdx,
      elemMeta,
    });
    const writeEndIdx = tbl.insert(stream.getWriteEnd());
    stream.setWriteEndIdx(writeEndIdx);
    const readEndIdx = tbl.insert(stream.getReadEnd());
    stream.setReadEndIdx(readEndIdx);
    
    const rep = STREAMS.insert(stream);
    stream.setRep(rep);
    
    return { writeEndIdx, readEndIdx };
  }
  
  getStreamEnd(args) {
    _debugLog('[ComponentAsyncState#getStreamEnd()] args', args);
    const { tableIdx, streamIdx } = args;
    if (tableIdx === undefined) { throw new Error('missing table idx while retrieveing stream end'); }
    if (streamIdx === undefined) { throw new Error('missing stream idx while retrieveing stream end'); }
    
    const tbl = this.#streams.get(tableIdx);
    if (!tbl) {
      throw new Error(`missing stream table [${tableIdx}] in component [${this.#componentIdx}] while getting stream`);
    }
    
    const stream = tbl.get(streamIdx);
    return stream;
  }
  
  removeStreamEnd(args) {
    _debugLog('[ComponentAsyncState#removeStreamEnd()] args', args);
    const { tableIdx, streamIdx } = args;
    if (tableIdx === undefined) { throw new Error("missing table idx while removing stream end"); }
    if (streamIdx === undefined) { throw new Error("missing stream idx while removing stream end"); }
    
    const tbl = this.#streams.get(tableIdx);
    if (!tbl) {
      throw new Error(`missing stream table [${tableIdx}] in component [${this.#componentIdx}] while removing stream end`);
    }
    
    const stream = tbl.get(streamIdx);
    if (!stream) { throw new Error(`component [${this.#componentIdx}] missing stream [${streamIdx}]`); }
    
    const removed = tbl.remove(streamIdx);
    if (!removed) {
      throw new Error(`missing stream [${streamIdx}] (table [${tableIdx}]) in component [${this.#componentIdx}] while removing stream end`);
    }
    
    return stream;
  }
}

const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
let _fs;
async function fetchCompile (url) {
  if (isNode) {
    _fs = _fs || await import('node:fs/promises');
    return WebAssembly.compile(await _fs.readFile(url));
  }
  return fetch(url).then(WebAssembly.compileStreaming);
}

const symbolCabiDispose = Symbol.for('cabiDispose');

const symbolRscHandle = Symbol('handle');

const symbolRscRep = Symbol.for('cabiRep');

const symbolDispose = Symbol.dispose || Symbol.for('dispose');

const handleTables = [];

class ComponentError extends Error {
  constructor (value) {
    const enumerable = typeof value !== 'string';
    super(enumerable ? `${String(value)} (see error.payload)` : value);
    Object.defineProperty(this, 'payload', { value, enumerable });
  }
}

function getErrorPayload(e) {
  if (e && hasOwnProperty.call(e, 'payload')) return e.payload;
  if (e instanceof Error) throw e;
  return e;
}

function throwInvalidBool() {
  throw new TypeError('invalid variant discriminant for bool');
}

const hasOwnProperty = Object.prototype.hasOwnProperty;


if (!getCoreModule) getCoreModule = (name) => fetchCompile(new URL(`./${name}`, import.meta.url));
const module0 = getCoreModule('heartwood.core.wasm');
const module1 = getCoreModule('heartwood.core2.wasm');
const module2 = getCoreModule('heartwood.core3.wasm');
const module3 = getCoreModule('heartwood.core4.wasm');

const { getEnvironment } = imports['wasi:cli/environment'];
getEnvironment._isHostProvided = true;

if (getEnvironment=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'getEnvironment', was 'getEnvironment' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { exit } = imports['wasi:cli/exit'];
exit._isHostProvided = true;

if (exit=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'exit', was 'exit' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { getStderr } = imports['wasi:cli/stderr'];
getStderr._isHostProvided = true;

if (getStderr=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'getStderr', was 'getStderr' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { getStdin } = imports['wasi:cli/stdin'];
getStdin._isHostProvided = true;

if (getStdin=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'getStdin', was 'getStdin' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { getStdout } = imports['wasi:cli/stdout'];
getStdout._isHostProvided = true;

if (getStdout=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'getStdout', was 'getStdout' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { getDirectories } = imports['wasi:filesystem/preopens'];
getDirectories._isHostProvided = true;

if (getDirectories=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'getDirectories', was 'getDirectories' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { Descriptor, filesystemErrorCode } = imports['wasi:filesystem/types'];
Descriptor._isHostProvided = true;

if (Descriptor=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'Descriptor', was 'Descriptor' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

filesystemErrorCode._isHostProvided = true;

if (filesystemErrorCode=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'filesystemErrorCode', was 'filesystemErrorCode' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { Error: Error$1 } = imports['wasi:io/error'];
Error$1._isHostProvided = true;

if (Error$1=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'Error$1', was 'Error' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { InputStream, OutputStream } = imports['wasi:io/streams'];
InputStream._isHostProvided = true;

if (InputStream=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'InputStream', was 'InputStream' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

OutputStream._isHostProvided = true;

if (OutputStream=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'OutputStream', was 'OutputStream' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { getRandomBytes } = imports['wasi:random/random'];
getRandomBytes._isHostProvided = true;

if (getRandomBytes=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'getRandomBytes', was 'getRandomBytes' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

let gen = (function* _initGenerator () {
  let exports0;
  let exports1;
  
  let lowered_import_0_metadata = {
    qualifiedImportFn: 'wasi:cli/stderr@0.2.3#get-stderr',
    moduleIdx: null,
  };
  
  const handleTable1 = [T_FLAG, 0];
  const captureTable1= new Map();
  let captureCnt1 = 0;
  handleTables[1] = handleTable1;
  
  function trampoline4() {
    _debugLog('[iface="wasi:cli/stderr@0.2.3", function="get-stderr"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = false;
    hostProvided = getStderr?._isHostProvided;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: 0,
        isAsync: false,
        entryFnName: 'getStderr',
        getCallbackFn: () => null,
        callbackFnName: 'null',
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(0)?.task;
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      const isHostAsyncImport = hostProvided && false;
      if (isHostAsyncImport) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error("Missing subtask for host import, has the import been lowered? (ensure asyncImports are set properly)");
        }
        subtask.setChildTask(task);
        task.setParentSubtask(subtask);
      }
    }
    
    let ret =  getStderr();
    endCurrentTask(0);
    if (!(ret instanceof OutputStream)) {
      throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
    }
    var handle0 = ret[symbolRscHandle];
    if (!handle0) {
      const rep = ret[symbolRscRep] || ++captureCnt1;
      captureTable1.set(rep, ret);
      handle0 = rscTableCreateOwn(handleTable1, rep);
    }
    _debugLog('[iface="wasi:cli/stderr@0.2.3", function="get-stderr"][Instruction::Return]', {
      funcName: 'get-stderr',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    return handle0;
  }
  
  
  let lowered_import_1_metadata = {
    qualifiedImportFn: 'wasi:cli/stdin@0.2.3#get-stdin',
    moduleIdx: null,
  };
  
  const handleTable2 = [T_FLAG, 0];
  const captureTable2= new Map();
  let captureCnt2 = 0;
  handleTables[2] = handleTable2;
  
  function trampoline5() {
    _debugLog('[iface="wasi:cli/stdin@0.2.3", function="get-stdin"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = false;
    hostProvided = getStdin?._isHostProvided;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: 0,
        isAsync: false,
        entryFnName: 'getStdin',
        getCallbackFn: () => null,
        callbackFnName: 'null',
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(0)?.task;
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      const isHostAsyncImport = hostProvided && false;
      if (isHostAsyncImport) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error("Missing subtask for host import, has the import been lowered? (ensure asyncImports are set properly)");
        }
        subtask.setChildTask(task);
        task.setParentSubtask(subtask);
      }
    }
    
    let ret =  getStdin();
    endCurrentTask(0);
    if (!(ret instanceof InputStream)) {
      throw new TypeError('Resource error: Not a valid "InputStream" resource.');
    }
    var handle0 = ret[symbolRscHandle];
    if (!handle0) {
      const rep = ret[symbolRscRep] || ++captureCnt2;
      captureTable2.set(rep, ret);
      handle0 = rscTableCreateOwn(handleTable2, rep);
    }
    _debugLog('[iface="wasi:cli/stdin@0.2.3", function="get-stdin"][Instruction::Return]', {
      funcName: 'get-stdin',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    return handle0;
  }
  
  
  let lowered_import_2_metadata = {
    qualifiedImportFn: 'wasi:cli/stdout@0.2.3#get-stdout',
    moduleIdx: null,
  };
  
  
  function trampoline6() {
    _debugLog('[iface="wasi:cli/stdout@0.2.3", function="get-stdout"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = false;
    hostProvided = getStdout?._isHostProvided;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: 0,
        isAsync: false,
        entryFnName: 'getStdout',
        getCallbackFn: () => null,
        callbackFnName: 'null',
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(0)?.task;
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      const isHostAsyncImport = hostProvided && false;
      if (isHostAsyncImport) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error("Missing subtask for host import, has the import been lowered? (ensure asyncImports are set properly)");
        }
        subtask.setChildTask(task);
        task.setParentSubtask(subtask);
      }
    }
    
    let ret =  getStdout();
    endCurrentTask(0);
    if (!(ret instanceof OutputStream)) {
      throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
    }
    var handle0 = ret[symbolRscHandle];
    if (!handle0) {
      const rep = ret[symbolRscRep] || ++captureCnt1;
      captureTable1.set(rep, ret);
      handle0 = rscTableCreateOwn(handleTable1, rep);
    }
    _debugLog('[iface="wasi:cli/stdout@0.2.3", function="get-stdout"][Instruction::Return]', {
      funcName: 'get-stdout',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    return handle0;
  }
  
  
  let lowered_import_3_metadata = {
    qualifiedImportFn: 'wasi:cli/exit@0.2.3#exit',
    moduleIdx: null,
  };
  
  
  function trampoline7(arg0) {
    let variant0;
    switch (arg0) {
      case 0: {
        variant0= {
          tag: 'ok',
          val: undefined
        };
        break;
      }
      case 1: {
        variant0= {
          tag: 'err',
          val: undefined
        };
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for expected');
      }
    }
    _debugLog('[iface="wasi:cli/exit@0.2.3", function="exit"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = false;
    hostProvided = exit?._isHostProvided;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: 0,
        isAsync: false,
        entryFnName: 'exit',
        getCallbackFn: () => null,
        callbackFnName: 'null',
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(0)?.task;
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      const isHostAsyncImport = hostProvided && false;
      if (isHostAsyncImport) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error("Missing subtask for host import, has the import been lowered? (ensure asyncImports are set properly)");
        }
        subtask.setChildTask(task);
        task.setParentSubtask(subtask);
      }
    }
    
    let ret; exit(variant0);
    endCurrentTask(0);
    _debugLog('[iface="wasi:cli/exit@0.2.3", function="exit"][Instruction::Return]', {
      funcName: 'exit',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  let exports2;
  let memory0;
  let realloc0;
  
  let lowered_import_4_metadata = {
    qualifiedImportFn: 'wasi:cli/environment@0.2.3#get-environment',
    moduleIdx: null,
  };
  
  
  function trampoline8(arg0) {
    _debugLog('[iface="wasi:cli/environment@0.2.3", function="get-environment"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = false;
    hostProvided = getEnvironment?._isHostProvided;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: 0,
        isAsync: false,
        entryFnName: 'getEnvironment',
        getCallbackFn: () => null,
        callbackFnName: 'null',
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(0)?.task;
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      const isHostAsyncImport = hostProvided && false;
      if (isHostAsyncImport) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error("Missing subtask for host import, has the import been lowered? (ensure asyncImports are set properly)");
        }
        subtask.setChildTask(task);
        task.setParentSubtask(subtask);
      }
    }
    
    let ret =  getEnvironment();
    endCurrentTask(0);
    var vec3 = ret;
    var len3 = vec3.length;
    var result3 = realloc0(0, 0, 4, len3 * 16);
    for (let i = 0; i < vec3.length; i++) {
      const e = vec3[i];
      const base = result3 + i * 16;var [tuple0_0, tuple0_1] = e;
      
      var encodeRes = _utf8AllocateAndEncode(tuple0_0, realloc0, memory0);
      var ptr1= encodeRes.ptr;
      var len1 = encodeRes.len;
      
      dataView(memory0).setUint32(base + 4, len1, true);
      dataView(memory0).setUint32(base + 0, ptr1, true);
      
      var encodeRes = _utf8AllocateAndEncode(tuple0_1, realloc0, memory0);
      var ptr2= encodeRes.ptr;
      var len2 = encodeRes.len;
      
      dataView(memory0).setUint32(base + 12, len2, true);
      dataView(memory0).setUint32(base + 8, ptr2, true);
    }
    dataView(memory0).setUint32(arg0 + 4, len3, true);
    dataView(memory0).setUint32(arg0 + 0, result3, true);
    _debugLog('[iface="wasi:cli/environment@0.2.3", function="get-environment"][Instruction::Return]', {
      funcName: 'get-environment',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  let lowered_import_5_metadata = {
    qualifiedImportFn: 'wasi:filesystem/types@0.2.3#filesystem-error-code',
    moduleIdx: null,
  };
  
  const handleTable0 = [T_FLAG, 0];
  const captureTable0= new Map();
  let captureCnt0 = 0;
  handleTables[0] = handleTable0;
  
  function trampoline9(arg0, arg1) {
    var handle1 = arg0;
    var rep2 = handleTable0[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable0.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Error$1.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.3", function="filesystem-error-code"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = false;
    hostProvided = filesystemErrorCode?._isHostProvided;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: 0,
        isAsync: false,
        entryFnName: 'filesystemErrorCode',
        getCallbackFn: () => null,
        callbackFnName: 'null',
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(0)?.task;
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      const isHostAsyncImport = hostProvided && false;
      if (isHostAsyncImport) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error("Missing subtask for host import, has the import been lowered? (ensure asyncImports are set properly)");
        }
        subtask.setChildTask(task);
        task.setParentSubtask(subtask);
      }
    }
    
    let ret =  filesystemErrorCode(rsc0);
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant4 = ret;
    if (variant4 === null || variant4=== undefined) {
      dataView(memory0).setInt8(arg1 + 0, 0, true);
    } else {
      const e = variant4;
      dataView(memory0).setInt8(arg1 + 0, 1, true);
      var val3 = e;
      let enum3;
      switch (val3) {
        case 'access': {
          enum3 = 0;
          break;
        }
        case 'would-block': {
          enum3 = 1;
          break;
        }
        case 'already': {
          enum3 = 2;
          break;
        }
        case 'bad-descriptor': {
          enum3 = 3;
          break;
        }
        case 'busy': {
          enum3 = 4;
          break;
        }
        case 'deadlock': {
          enum3 = 5;
          break;
        }
        case 'quota': {
          enum3 = 6;
          break;
        }
        case 'exist': {
          enum3 = 7;
          break;
        }
        case 'file-too-large': {
          enum3 = 8;
          break;
        }
        case 'illegal-byte-sequence': {
          enum3 = 9;
          break;
        }
        case 'in-progress': {
          enum3 = 10;
          break;
        }
        case 'interrupted': {
          enum3 = 11;
          break;
        }
        case 'invalid': {
          enum3 = 12;
          break;
        }
        case 'io': {
          enum3 = 13;
          break;
        }
        case 'is-directory': {
          enum3 = 14;
          break;
        }
        case 'loop': {
          enum3 = 15;
          break;
        }
        case 'too-many-links': {
          enum3 = 16;
          break;
        }
        case 'message-size': {
          enum3 = 17;
          break;
        }
        case 'name-too-long': {
          enum3 = 18;
          break;
        }
        case 'no-device': {
          enum3 = 19;
          break;
        }
        case 'no-entry': {
          enum3 = 20;
          break;
        }
        case 'no-lock': {
          enum3 = 21;
          break;
        }
        case 'insufficient-memory': {
          enum3 = 22;
          break;
        }
        case 'insufficient-space': {
          enum3 = 23;
          break;
        }
        case 'not-directory': {
          enum3 = 24;
          break;
        }
        case 'not-empty': {
          enum3 = 25;
          break;
        }
        case 'not-recoverable': {
          enum3 = 26;
          break;
        }
        case 'unsupported': {
          enum3 = 27;
          break;
        }
        case 'no-tty': {
          enum3 = 28;
          break;
        }
        case 'no-such-device': {
          enum3 = 29;
          break;
        }
        case 'overflow': {
          enum3 = 30;
          break;
        }
        case 'not-permitted': {
          enum3 = 31;
          break;
        }
        case 'pipe': {
          enum3 = 32;
          break;
        }
        case 'read-only': {
          enum3 = 33;
          break;
        }
        case 'invalid-seek': {
          enum3 = 34;
          break;
        }
        case 'text-file-busy': {
          enum3 = 35;
          break;
        }
        case 'cross-device': {
          enum3 = 36;
          break;
        }
        default: {
          if ((e) instanceof Error) {
            console.error(e);
          }
          
          throw new TypeError(`"${val3}" is not one of the cases of error-code`);
        }
      }
      dataView(memory0).setInt8(arg1 + 1, enum3, true);
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.3", function="filesystem-error-code"][Instruction::Return]', {
      funcName: 'filesystem-error-code',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  let lowered_import_6_metadata = {
    qualifiedImportFn: 'wasi:filesystem/types@0.2.3#[method]descriptor.write-via-stream',
    moduleIdx: null,
  };
  
  const handleTable3 = [T_FLAG, 0];
  const captureTable3= new Map();
  let captureCnt3 = 0;
  handleTables[3] = handleTable3;
  
  function trampoline10(arg0, arg1, arg2) {
    var handle1 = arg0;
    var rep2 = handleTable3[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable3.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.3", function="[method]descriptor.write-via-stream"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = false;
    hostProvided = rsc0.writeViaStream?._isHostProvided;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: 0,
        isAsync: false,
        entryFnName: 'writeViaStream',
        getCallbackFn: () => null,
        callbackFnName: 'null',
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(0)?.task;
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      const isHostAsyncImport = hostProvided && false;
      if (isHostAsyncImport) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error("Missing subtask for host import, has the import been lowered? (ensure asyncImports are set properly)");
        }
        subtask.setChildTask(task);
        task.setParentSubtask(subtask);
      }
    }
    
    
    let ret;
    try {
      ret = { tag: 'ok', val:  rsc0.writeViaStream(BigInt.asUintN(64, arg1))};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant5 = ret;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg2 + 0, 0, true);
        if (!(e instanceof OutputStream)) {
          throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
        }
        var handle3 = e[symbolRscHandle];
        if (!handle3) {
          const rep = e[symbolRscRep] || ++captureCnt1;
          captureTable1.set(rep, e);
          handle3 = rscTableCreateOwn(handleTable1, rep);
        }
        dataView(memory0).setInt32(arg2 + 4, handle3, true);
        break;
      }
      case 'err': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg2 + 0, 1, true);
        var val4 = e;
        let enum4;
        switch (val4) {
          case 'access': {
            enum4 = 0;
            break;
          }
          case 'would-block': {
            enum4 = 1;
            break;
          }
          case 'already': {
            enum4 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum4 = 3;
            break;
          }
          case 'busy': {
            enum4 = 4;
            break;
          }
          case 'deadlock': {
            enum4 = 5;
            break;
          }
          case 'quota': {
            enum4 = 6;
            break;
          }
          case 'exist': {
            enum4 = 7;
            break;
          }
          case 'file-too-large': {
            enum4 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum4 = 9;
            break;
          }
          case 'in-progress': {
            enum4 = 10;
            break;
          }
          case 'interrupted': {
            enum4 = 11;
            break;
          }
          case 'invalid': {
            enum4 = 12;
            break;
          }
          case 'io': {
            enum4 = 13;
            break;
          }
          case 'is-directory': {
            enum4 = 14;
            break;
          }
          case 'loop': {
            enum4 = 15;
            break;
          }
          case 'too-many-links': {
            enum4 = 16;
            break;
          }
          case 'message-size': {
            enum4 = 17;
            break;
          }
          case 'name-too-long': {
            enum4 = 18;
            break;
          }
          case 'no-device': {
            enum4 = 19;
            break;
          }
          case 'no-entry': {
            enum4 = 20;
            break;
          }
          case 'no-lock': {
            enum4 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum4 = 22;
            break;
          }
          case 'insufficient-space': {
            enum4 = 23;
            break;
          }
          case 'not-directory': {
            enum4 = 24;
            break;
          }
          case 'not-empty': {
            enum4 = 25;
            break;
          }
          case 'not-recoverable': {
            enum4 = 26;
            break;
          }
          case 'unsupported': {
            enum4 = 27;
            break;
          }
          case 'no-tty': {
            enum4 = 28;
            break;
          }
          case 'no-such-device': {
            enum4 = 29;
            break;
          }
          case 'overflow': {
            enum4 = 30;
            break;
          }
          case 'not-permitted': {
            enum4 = 31;
            break;
          }
          case 'pipe': {
            enum4 = 32;
            break;
          }
          case 'read-only': {
            enum4 = 33;
            break;
          }
          case 'invalid-seek': {
            enum4 = 34;
            break;
          }
          case 'text-file-busy': {
            enum4 = 35;
            break;
          }
          case 'cross-device': {
            enum4 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val4}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg2 + 4, enum4, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.3", function="[method]descriptor.write-via-stream"][Instruction::Return]', {
      funcName: '[method]descriptor.write-via-stream',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  let lowered_import_7_metadata = {
    qualifiedImportFn: 'wasi:filesystem/types@0.2.3#[method]descriptor.append-via-stream',
    moduleIdx: null,
  };
  
  
  function trampoline11(arg0, arg1) {
    var handle1 = arg0;
    var rep2 = handleTable3[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable3.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.3", function="[method]descriptor.append-via-stream"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = false;
    hostProvided = rsc0.appendViaStream?._isHostProvided;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: 0,
        isAsync: false,
        entryFnName: 'appendViaStream',
        getCallbackFn: () => null,
        callbackFnName: 'null',
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(0)?.task;
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      const isHostAsyncImport = hostProvided && false;
      if (isHostAsyncImport) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error("Missing subtask for host import, has the import been lowered? (ensure asyncImports are set properly)");
        }
        subtask.setChildTask(task);
        task.setParentSubtask(subtask);
      }
    }
    
    
    let ret;
    try {
      ret = { tag: 'ok', val:  rsc0.appendViaStream()};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant5 = ret;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        if (!(e instanceof OutputStream)) {
          throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
        }
        var handle3 = e[symbolRscHandle];
        if (!handle3) {
          const rep = e[symbolRscRep] || ++captureCnt1;
          captureTable1.set(rep, e);
          handle3 = rscTableCreateOwn(handleTable1, rep);
        }
        dataView(memory0).setInt32(arg1 + 4, handle3, true);
        break;
      }
      case 'err': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var val4 = e;
        let enum4;
        switch (val4) {
          case 'access': {
            enum4 = 0;
            break;
          }
          case 'would-block': {
            enum4 = 1;
            break;
          }
          case 'already': {
            enum4 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum4 = 3;
            break;
          }
          case 'busy': {
            enum4 = 4;
            break;
          }
          case 'deadlock': {
            enum4 = 5;
            break;
          }
          case 'quota': {
            enum4 = 6;
            break;
          }
          case 'exist': {
            enum4 = 7;
            break;
          }
          case 'file-too-large': {
            enum4 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum4 = 9;
            break;
          }
          case 'in-progress': {
            enum4 = 10;
            break;
          }
          case 'interrupted': {
            enum4 = 11;
            break;
          }
          case 'invalid': {
            enum4 = 12;
            break;
          }
          case 'io': {
            enum4 = 13;
            break;
          }
          case 'is-directory': {
            enum4 = 14;
            break;
          }
          case 'loop': {
            enum4 = 15;
            break;
          }
          case 'too-many-links': {
            enum4 = 16;
            break;
          }
          case 'message-size': {
            enum4 = 17;
            break;
          }
          case 'name-too-long': {
            enum4 = 18;
            break;
          }
          case 'no-device': {
            enum4 = 19;
            break;
          }
          case 'no-entry': {
            enum4 = 20;
            break;
          }
          case 'no-lock': {
            enum4 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum4 = 22;
            break;
          }
          case 'insufficient-space': {
            enum4 = 23;
            break;
          }
          case 'not-directory': {
            enum4 = 24;
            break;
          }
          case 'not-empty': {
            enum4 = 25;
            break;
          }
          case 'not-recoverable': {
            enum4 = 26;
            break;
          }
          case 'unsupported': {
            enum4 = 27;
            break;
          }
          case 'no-tty': {
            enum4 = 28;
            break;
          }
          case 'no-such-device': {
            enum4 = 29;
            break;
          }
          case 'overflow': {
            enum4 = 30;
            break;
          }
          case 'not-permitted': {
            enum4 = 31;
            break;
          }
          case 'pipe': {
            enum4 = 32;
            break;
          }
          case 'read-only': {
            enum4 = 33;
            break;
          }
          case 'invalid-seek': {
            enum4 = 34;
            break;
          }
          case 'text-file-busy': {
            enum4 = 35;
            break;
          }
          case 'cross-device': {
            enum4 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val4}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg1 + 4, enum4, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.3", function="[method]descriptor.append-via-stream"][Instruction::Return]', {
      funcName: '[method]descriptor.append-via-stream',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  let lowered_import_8_metadata = {
    qualifiedImportFn: 'wasi:filesystem/types@0.2.3#[method]descriptor.get-type',
    moduleIdx: null,
  };
  
  
  function trampoline12(arg0, arg1) {
    var handle1 = arg0;
    var rep2 = handleTable3[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable3.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.3", function="[method]descriptor.get-type"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = false;
    hostProvided = rsc0.getType?._isHostProvided;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: 0,
        isAsync: false,
        entryFnName: 'getType',
        getCallbackFn: () => null,
        callbackFnName: 'null',
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(0)?.task;
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      const isHostAsyncImport = hostProvided && false;
      if (isHostAsyncImport) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error("Missing subtask for host import, has the import been lowered? (ensure asyncImports are set properly)");
        }
        subtask.setChildTask(task);
        task.setParentSubtask(subtask);
      }
    }
    
    
    let ret;
    try {
      ret = { tag: 'ok', val:  rsc0.getType()};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant5 = ret;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        var val3 = e;
        let enum3;
        switch (val3) {
          case 'unknown': {
            enum3 = 0;
            break;
          }
          case 'block-device': {
            enum3 = 1;
            break;
          }
          case 'character-device': {
            enum3 = 2;
            break;
          }
          case 'directory': {
            enum3 = 3;
            break;
          }
          case 'fifo': {
            enum3 = 4;
            break;
          }
          case 'symbolic-link': {
            enum3 = 5;
            break;
          }
          case 'regular-file': {
            enum3 = 6;
            break;
          }
          case 'socket': {
            enum3 = 7;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val3}" is not one of the cases of descriptor-type`);
          }
        }
        dataView(memory0).setInt8(arg1 + 1, enum3, true);
        break;
      }
      case 'err': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var val4 = e;
        let enum4;
        switch (val4) {
          case 'access': {
            enum4 = 0;
            break;
          }
          case 'would-block': {
            enum4 = 1;
            break;
          }
          case 'already': {
            enum4 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum4 = 3;
            break;
          }
          case 'busy': {
            enum4 = 4;
            break;
          }
          case 'deadlock': {
            enum4 = 5;
            break;
          }
          case 'quota': {
            enum4 = 6;
            break;
          }
          case 'exist': {
            enum4 = 7;
            break;
          }
          case 'file-too-large': {
            enum4 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum4 = 9;
            break;
          }
          case 'in-progress': {
            enum4 = 10;
            break;
          }
          case 'interrupted': {
            enum4 = 11;
            break;
          }
          case 'invalid': {
            enum4 = 12;
            break;
          }
          case 'io': {
            enum4 = 13;
            break;
          }
          case 'is-directory': {
            enum4 = 14;
            break;
          }
          case 'loop': {
            enum4 = 15;
            break;
          }
          case 'too-many-links': {
            enum4 = 16;
            break;
          }
          case 'message-size': {
            enum4 = 17;
            break;
          }
          case 'name-too-long': {
            enum4 = 18;
            break;
          }
          case 'no-device': {
            enum4 = 19;
            break;
          }
          case 'no-entry': {
            enum4 = 20;
            break;
          }
          case 'no-lock': {
            enum4 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum4 = 22;
            break;
          }
          case 'insufficient-space': {
            enum4 = 23;
            break;
          }
          case 'not-directory': {
            enum4 = 24;
            break;
          }
          case 'not-empty': {
            enum4 = 25;
            break;
          }
          case 'not-recoverable': {
            enum4 = 26;
            break;
          }
          case 'unsupported': {
            enum4 = 27;
            break;
          }
          case 'no-tty': {
            enum4 = 28;
            break;
          }
          case 'no-such-device': {
            enum4 = 29;
            break;
          }
          case 'overflow': {
            enum4 = 30;
            break;
          }
          case 'not-permitted': {
            enum4 = 31;
            break;
          }
          case 'pipe': {
            enum4 = 32;
            break;
          }
          case 'read-only': {
            enum4 = 33;
            break;
          }
          case 'invalid-seek': {
            enum4 = 34;
            break;
          }
          case 'text-file-busy': {
            enum4 = 35;
            break;
          }
          case 'cross-device': {
            enum4 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val4}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg1 + 1, enum4, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.3", function="[method]descriptor.get-type"][Instruction::Return]', {
      funcName: '[method]descriptor.get-type',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  let lowered_import_9_metadata = {
    qualifiedImportFn: 'wasi:filesystem/types@0.2.3#[method]descriptor.stat',
    moduleIdx: null,
  };
  
  
  function trampoline13(arg0, arg1) {
    var handle1 = arg0;
    var rep2 = handleTable3[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable3.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.3", function="[method]descriptor.stat"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = false;
    hostProvided = rsc0.stat?._isHostProvided;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: 0,
        isAsync: false,
        entryFnName: 'stat',
        getCallbackFn: () => null,
        callbackFnName: 'null',
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(0)?.task;
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      const isHostAsyncImport = hostProvided && false;
      if (isHostAsyncImport) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error("Missing subtask for host import, has the import been lowered? (ensure asyncImports are set properly)");
        }
        subtask.setChildTask(task);
        task.setParentSubtask(subtask);
      }
    }
    
    
    let ret;
    try {
      ret = { tag: 'ok', val:  rsc0.stat()};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant12 = ret;
    switch (variant12.tag) {
      case 'ok': {
        const e = variant12.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        var {type: v3_0, linkCount: v3_1, size: v3_2, dataAccessTimestamp: v3_3, dataModificationTimestamp: v3_4, statusChangeTimestamp: v3_5 } = e;
        var val4 = v3_0;
        let enum4;
        switch (val4) {
          case 'unknown': {
            enum4 = 0;
            break;
          }
          case 'block-device': {
            enum4 = 1;
            break;
          }
          case 'character-device': {
            enum4 = 2;
            break;
          }
          case 'directory': {
            enum4 = 3;
            break;
          }
          case 'fifo': {
            enum4 = 4;
            break;
          }
          case 'symbolic-link': {
            enum4 = 5;
            break;
          }
          case 'regular-file': {
            enum4 = 6;
            break;
          }
          case 'socket': {
            enum4 = 7;
            break;
          }
          default: {
            if ((v3_0) instanceof Error) {
              console.error(v3_0);
            }
            
            throw new TypeError(`"${val4}" is not one of the cases of descriptor-type`);
          }
        }
        dataView(memory0).setInt8(arg1 + 8, enum4, true);
        dataView(memory0).setBigInt64(arg1 + 16, toUint64(v3_1), true);
        dataView(memory0).setBigInt64(arg1 + 24, toUint64(v3_2), true);
        var variant6 = v3_3;
        if (variant6 === null || variant6=== undefined) {
          dataView(memory0).setInt8(arg1 + 32, 0, true);
        } else {
          const e = variant6;
          dataView(memory0).setInt8(arg1 + 32, 1, true);
          var {seconds: v5_0, nanoseconds: v5_1 } = e;
          dataView(memory0).setBigInt64(arg1 + 40, toUint64(v5_0), true);
          dataView(memory0).setInt32(arg1 + 48, toUint32(v5_1), true);
        }
        var variant8 = v3_4;
        if (variant8 === null || variant8=== undefined) {
          dataView(memory0).setInt8(arg1 + 56, 0, true);
        } else {
          const e = variant8;
          dataView(memory0).setInt8(arg1 + 56, 1, true);
          var {seconds: v7_0, nanoseconds: v7_1 } = e;
          dataView(memory0).setBigInt64(arg1 + 64, toUint64(v7_0), true);
          dataView(memory0).setInt32(arg1 + 72, toUint32(v7_1), true);
        }
        var variant10 = v3_5;
        if (variant10 === null || variant10=== undefined) {
          dataView(memory0).setInt8(arg1 + 80, 0, true);
        } else {
          const e = variant10;
          dataView(memory0).setInt8(arg1 + 80, 1, true);
          var {seconds: v9_0, nanoseconds: v9_1 } = e;
          dataView(memory0).setBigInt64(arg1 + 88, toUint64(v9_0), true);
          dataView(memory0).setInt32(arg1 + 96, toUint32(v9_1), true);
        }
        break;
      }
      case 'err': {
        const e = variant12.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var val11 = e;
        let enum11;
        switch (val11) {
          case 'access': {
            enum11 = 0;
            break;
          }
          case 'would-block': {
            enum11 = 1;
            break;
          }
          case 'already': {
            enum11 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum11 = 3;
            break;
          }
          case 'busy': {
            enum11 = 4;
            break;
          }
          case 'deadlock': {
            enum11 = 5;
            break;
          }
          case 'quota': {
            enum11 = 6;
            break;
          }
          case 'exist': {
            enum11 = 7;
            break;
          }
          case 'file-too-large': {
            enum11 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum11 = 9;
            break;
          }
          case 'in-progress': {
            enum11 = 10;
            break;
          }
          case 'interrupted': {
            enum11 = 11;
            break;
          }
          case 'invalid': {
            enum11 = 12;
            break;
          }
          case 'io': {
            enum11 = 13;
            break;
          }
          case 'is-directory': {
            enum11 = 14;
            break;
          }
          case 'loop': {
            enum11 = 15;
            break;
          }
          case 'too-many-links': {
            enum11 = 16;
            break;
          }
          case 'message-size': {
            enum11 = 17;
            break;
          }
          case 'name-too-long': {
            enum11 = 18;
            break;
          }
          case 'no-device': {
            enum11 = 19;
            break;
          }
          case 'no-entry': {
            enum11 = 20;
            break;
          }
          case 'no-lock': {
            enum11 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum11 = 22;
            break;
          }
          case 'insufficient-space': {
            enum11 = 23;
            break;
          }
          case 'not-directory': {
            enum11 = 24;
            break;
          }
          case 'not-empty': {
            enum11 = 25;
            break;
          }
          case 'not-recoverable': {
            enum11 = 26;
            break;
          }
          case 'unsupported': {
            enum11 = 27;
            break;
          }
          case 'no-tty': {
            enum11 = 28;
            break;
          }
          case 'no-such-device': {
            enum11 = 29;
            break;
          }
          case 'overflow': {
            enum11 = 30;
            break;
          }
          case 'not-permitted': {
            enum11 = 31;
            break;
          }
          case 'pipe': {
            enum11 = 32;
            break;
          }
          case 'read-only': {
            enum11 = 33;
            break;
          }
          case 'invalid-seek': {
            enum11 = 34;
            break;
          }
          case 'text-file-busy': {
            enum11 = 35;
            break;
          }
          case 'cross-device': {
            enum11 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val11}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg1 + 8, enum11, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.3", function="[method]descriptor.stat"][Instruction::Return]', {
      funcName: '[method]descriptor.stat',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  let lowered_import_10_metadata = {
    qualifiedImportFn: 'wasi:io/streams@0.2.3#[method]output-stream.check-write',
    moduleIdx: null,
  };
  
  
  function trampoline14(arg0, arg1) {
    var handle1 = arg0;
    var rep2 = handleTable1[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable1.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutputStream.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:io/streams@0.2.3", function="[method]output-stream.check-write"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = false;
    hostProvided = rsc0.checkWrite?._isHostProvided;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: 0,
        isAsync: false,
        entryFnName: 'checkWrite',
        getCallbackFn: () => null,
        callbackFnName: 'null',
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(0)?.task;
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      const isHostAsyncImport = hostProvided && false;
      if (isHostAsyncImport) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error("Missing subtask for host import, has the import been lowered? (ensure asyncImports are set properly)");
        }
        subtask.setChildTask(task);
        task.setParentSubtask(subtask);
      }
    }
    
    
    let ret;
    try {
      ret = { tag: 'ok', val:  rsc0.checkWrite()};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant5 = ret;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        dataView(memory0).setBigInt64(arg1 + 8, toUint64(e), true);
        break;
      }
      case 'err': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var variant4 = e;
        switch (variant4.tag) {
          case 'last-operation-failed': {
            const e = variant4.val;
            dataView(memory0).setInt8(arg1 + 8, 0, true);
            if (!(e instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid "Error" resource.');
            }
            var handle3 = e[symbolRscHandle];
            if (!handle3) {
              const rep = e[symbolRscRep] || ++captureCnt0;
              captureTable0.set(rep, e);
              handle3 = rscTableCreateOwn(handleTable0, rep);
            }
            dataView(memory0).setInt32(arg1 + 12, handle3, true);
            break;
          }
          case 'closed': {
            dataView(memory0).setInt8(arg1 + 8, 1, true);
            break;
          }
          default: {
            throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant4.tag)}\` (received \`${variant4}\`) specified for \`StreamError\``);
          }
        }
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:io/streams@0.2.3", function="[method]output-stream.check-write"][Instruction::Return]', {
      funcName: '[method]output-stream.check-write',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  let lowered_import_11_metadata = {
    qualifiedImportFn: 'wasi:io/streams@0.2.3#[method]output-stream.write',
    moduleIdx: null,
  };
  
  
  function trampoline15(arg0, arg1, arg2, arg3) {
    var handle1 = arg0;
    var rep2 = handleTable1[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable1.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutputStream.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    var ptr3 = arg1;
    var len3 = arg2;
    var result3 = new Uint8Array(memory0.buffer.slice(ptr3, ptr3 + len3 * 1));
    _debugLog('[iface="wasi:io/streams@0.2.3", function="[method]output-stream.write"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = false;
    hostProvided = rsc0.write?._isHostProvided;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: 0,
        isAsync: false,
        entryFnName: 'write',
        getCallbackFn: () => null,
        callbackFnName: 'null',
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(0)?.task;
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      const isHostAsyncImport = hostProvided && false;
      if (isHostAsyncImport) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error("Missing subtask for host import, has the import been lowered? (ensure asyncImports are set properly)");
        }
        subtask.setChildTask(task);
        task.setParentSubtask(subtask);
      }
    }
    
    
    let ret;
    try {
      ret = { tag: 'ok', val:  rsc0.write(result3)};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant6 = ret;
    switch (variant6.tag) {
      case 'ok': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg3 + 0, 0, true);
        break;
      }
      case 'err': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg3 + 0, 1, true);
        var variant5 = e;
        switch (variant5.tag) {
          case 'last-operation-failed': {
            const e = variant5.val;
            dataView(memory0).setInt8(arg3 + 4, 0, true);
            if (!(e instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid "Error" resource.');
            }
            var handle4 = e[symbolRscHandle];
            if (!handle4) {
              const rep = e[symbolRscRep] || ++captureCnt0;
              captureTable0.set(rep, e);
              handle4 = rscTableCreateOwn(handleTable0, rep);
            }
            dataView(memory0).setInt32(arg3 + 8, handle4, true);
            break;
          }
          case 'closed': {
            dataView(memory0).setInt8(arg3 + 4, 1, true);
            break;
          }
          default: {
            throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant5.tag)}\` (received \`${variant5}\`) specified for \`StreamError\``);
          }
        }
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:io/streams@0.2.3", function="[method]output-stream.write"][Instruction::Return]', {
      funcName: '[method]output-stream.write',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  let lowered_import_12_metadata = {
    qualifiedImportFn: 'wasi:io/streams@0.2.3#[method]output-stream.blocking-flush',
    moduleIdx: null,
  };
  
  
  function trampoline16(arg0, arg1) {
    var handle1 = arg0;
    var rep2 = handleTable1[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable1.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutputStream.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:io/streams@0.2.3", function="[method]output-stream.blocking-flush"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = false;
    hostProvided = rsc0.blockingFlush?._isHostProvided;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: 0,
        isAsync: false,
        entryFnName: 'blockingFlush',
        getCallbackFn: () => null,
        callbackFnName: 'null',
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(0)?.task;
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      const isHostAsyncImport = hostProvided && false;
      if (isHostAsyncImport) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error("Missing subtask for host import, has the import been lowered? (ensure asyncImports are set properly)");
        }
        subtask.setChildTask(task);
        task.setParentSubtask(subtask);
      }
    }
    
    
    let ret;
    try {
      ret = { tag: 'ok', val:  rsc0.blockingFlush()};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant5 = ret;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        break;
      }
      case 'err': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var variant4 = e;
        switch (variant4.tag) {
          case 'last-operation-failed': {
            const e = variant4.val;
            dataView(memory0).setInt8(arg1 + 4, 0, true);
            if (!(e instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid "Error" resource.');
            }
            var handle3 = e[symbolRscHandle];
            if (!handle3) {
              const rep = e[symbolRscRep] || ++captureCnt0;
              captureTable0.set(rep, e);
              handle3 = rscTableCreateOwn(handleTable0, rep);
            }
            dataView(memory0).setInt32(arg1 + 8, handle3, true);
            break;
          }
          case 'closed': {
            dataView(memory0).setInt8(arg1 + 4, 1, true);
            break;
          }
          default: {
            throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant4.tag)}\` (received \`${variant4}\`) specified for \`StreamError\``);
          }
        }
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:io/streams@0.2.3", function="[method]output-stream.blocking-flush"][Instruction::Return]', {
      funcName: '[method]output-stream.blocking-flush',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  let lowered_import_13_metadata = {
    qualifiedImportFn: 'wasi:io/streams@0.2.3#[method]output-stream.blocking-write-and-flush',
    moduleIdx: null,
  };
  
  
  function trampoline17(arg0, arg1, arg2, arg3) {
    var handle1 = arg0;
    var rep2 = handleTable1[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable1.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutputStream.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    var ptr3 = arg1;
    var len3 = arg2;
    var result3 = new Uint8Array(memory0.buffer.slice(ptr3, ptr3 + len3 * 1));
    _debugLog('[iface="wasi:io/streams@0.2.3", function="[method]output-stream.blocking-write-and-flush"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = false;
    hostProvided = rsc0.blockingWriteAndFlush?._isHostProvided;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: 0,
        isAsync: false,
        entryFnName: 'blockingWriteAndFlush',
        getCallbackFn: () => null,
        callbackFnName: 'null',
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(0)?.task;
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      const isHostAsyncImport = hostProvided && false;
      if (isHostAsyncImport) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error("Missing subtask for host import, has the import been lowered? (ensure asyncImports are set properly)");
        }
        subtask.setChildTask(task);
        task.setParentSubtask(subtask);
      }
    }
    
    
    let ret;
    try {
      ret = { tag: 'ok', val:  rsc0.blockingWriteAndFlush(result3)};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant6 = ret;
    switch (variant6.tag) {
      case 'ok': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg3 + 0, 0, true);
        break;
      }
      case 'err': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg3 + 0, 1, true);
        var variant5 = e;
        switch (variant5.tag) {
          case 'last-operation-failed': {
            const e = variant5.val;
            dataView(memory0).setInt8(arg3 + 4, 0, true);
            if (!(e instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid "Error" resource.');
            }
            var handle4 = e[symbolRscHandle];
            if (!handle4) {
              const rep = e[symbolRscRep] || ++captureCnt0;
              captureTable0.set(rep, e);
              handle4 = rscTableCreateOwn(handleTable0, rep);
            }
            dataView(memory0).setInt32(arg3 + 8, handle4, true);
            break;
          }
          case 'closed': {
            dataView(memory0).setInt8(arg3 + 4, 1, true);
            break;
          }
          default: {
            throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant5.tag)}\` (received \`${variant5}\`) specified for \`StreamError\``);
          }
        }
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:io/streams@0.2.3", function="[method]output-stream.blocking-write-and-flush"][Instruction::Return]', {
      funcName: '[method]output-stream.blocking-write-and-flush',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  let lowered_import_14_metadata = {
    qualifiedImportFn: 'wasi:random/random@0.2.3#get-random-bytes',
    moduleIdx: null,
  };
  
  
  function trampoline18(arg0, arg1) {
    _debugLog('[iface="wasi:random/random@0.2.3", function="get-random-bytes"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = false;
    hostProvided = getRandomBytes?._isHostProvided;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: 0,
        isAsync: false,
        entryFnName: 'getRandomBytes',
        getCallbackFn: () => null,
        callbackFnName: 'null',
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(0)?.task;
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      const isHostAsyncImport = hostProvided && false;
      if (isHostAsyncImport) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error("Missing subtask for host import, has the import been lowered? (ensure asyncImports are set properly)");
        }
        subtask.setChildTask(task);
        task.setParentSubtask(subtask);
      }
    }
    
    let ret =  getRandomBytes(BigInt.asUintN(64, arg0));
    endCurrentTask(0);
    var val0 = ret;
    var len0 = val0.byteLength;
    var ptr0 = realloc0(0, 0, 1, len0 * 1);
    
    let valData0;
    const valLenBytes0 = len0 * 1;
    if (Array.isArray(val0)) {
      // Regular array likely containing numbers, write values to memory
      let offset = 0;
      const dv0 = new DataView(memory0.buffer);
      for (const v of val0) {
        dv0.setUint8(ptr0+ offset, v, true);
        offset += 1;
      }
    } else {
      // TypedArray / ArrayBuffer-like, direct copy
      valData0 = new Uint8Array(val0.buffer || val0, val0.byteOffset, valLenBytes0);
      const out0 = new Uint8Array(memory0.buffer, ptr0,valLenBytes0);
      out0.set(valData0);
    }
    
    dataView(memory0).setUint32(arg1 + 4, len0, true);
    dataView(memory0).setUint32(arg1 + 0, ptr0, true);
    _debugLog('[iface="wasi:random/random@0.2.3", function="get-random-bytes"][Instruction::Return]', {
      funcName: 'get-random-bytes',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  let lowered_import_15_metadata = {
    qualifiedImportFn: 'wasi:filesystem/preopens@0.2.3#get-directories',
    moduleIdx: null,
  };
  
  
  function trampoline19(arg0) {
    _debugLog('[iface="wasi:filesystem/preopens@0.2.3", function="get-directories"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = false;
    hostProvided = getDirectories?._isHostProvided;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: 0,
        isAsync: false,
        entryFnName: 'getDirectories',
        getCallbackFn: () => null,
        callbackFnName: 'null',
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(0)?.task;
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      const isHostAsyncImport = hostProvided && false;
      if (isHostAsyncImport) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error("Missing subtask for host import, has the import been lowered? (ensure asyncImports are set properly)");
        }
        subtask.setChildTask(task);
        task.setParentSubtask(subtask);
      }
    }
    
    let ret =  getDirectories();
    endCurrentTask(0);
    var vec3 = ret;
    var len3 = vec3.length;
    var result3 = realloc0(0, 0, 4, len3 * 12);
    for (let i = 0; i < vec3.length; i++) {
      const e = vec3[i];
      const base = result3 + i * 12;var [tuple0_0, tuple0_1] = e;
      if (!(tuple0_0 instanceof Descriptor)) {
        throw new TypeError('Resource error: Not a valid "Descriptor" resource.');
      }
      var handle1 = tuple0_0[symbolRscHandle];
      if (!handle1) {
        const rep = tuple0_0[symbolRscRep] || ++captureCnt3;
        captureTable3.set(rep, tuple0_0);
        handle1 = rscTableCreateOwn(handleTable3, rep);
      }
      dataView(memory0).setInt32(base + 0, handle1, true);
      
      var encodeRes = _utf8AllocateAndEncode(tuple0_1, realloc0, memory0);
      var ptr2= encodeRes.ptr;
      var len2 = encodeRes.len;
      
      dataView(memory0).setUint32(base + 8, len2, true);
      dataView(memory0).setUint32(base + 4, ptr2, true);
    }
    dataView(memory0).setUint32(arg0 + 4, len3, true);
    dataView(memory0).setUint32(arg0 + 0, result3, true);
    _debugLog('[iface="wasi:filesystem/preopens@0.2.3", function="get-directories"][Instruction::Return]', {
      funcName: 'get-directories',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  let exports3;
  let realloc1;
  let postReturn0;
  let postReturn1;
  function trampoline0(handle) {
    const handleEntry = rscTableRemove(handleTable3, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable3.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable3.delete(handleEntry.rep);
      } else if (Descriptor[symbolCabiDispose]) {
        Descriptor[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  function trampoline1(handle) {
    const handleEntry = rscTableRemove(handleTable1, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable1.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable1.delete(handleEntry.rep);
      } else if (OutputStream[symbolCabiDispose]) {
        OutputStream[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  function trampoline2(handle) {
    const handleEntry = rscTableRemove(handleTable0, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable0.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable0.delete(handleEntry.rep);
      } else if (Error$1[symbolCabiDispose]) {
        Error$1[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  function trampoline3(handle) {
    const handleEntry = rscTableRemove(handleTable2, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable2.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable2.delete(handleEntry.rep);
      } else if (InputStream[symbolCabiDispose]) {
        InputStream[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  
  GlobalComponentAsyncLowers.define({
    componentIdx: lowered_import_0_metadata.moduleIdx,
    qualifiedImportFn: lowered_import_0_metadata.qualifiedImportFn,
    fn: _lowerImport.bind(
    null,
    {
      trampolineIdx: 4,
      componentIdx: 0,
      isAsync: false,
      paramLiftFns: [],
      metadata: lowered_import_0_metadata,
      resultLowerFns: [_lowerFlatOwn.bind(null, 1)],
      getCallbackFn: () => null,
      getPostReturnFn: () => null,
      isCancellable: false,
      memoryIdx: null,
      getMemoryFn: () => null,
      getReallocFn: () => null,
    },
    ),
  });
  
  
  GlobalComponentAsyncLowers.define({
    componentIdx: lowered_import_1_metadata.moduleIdx,
    qualifiedImportFn: lowered_import_1_metadata.qualifiedImportFn,
    fn: _lowerImport.bind(
    null,
    {
      trampolineIdx: 5,
      componentIdx: 0,
      isAsync: false,
      paramLiftFns: [],
      metadata: lowered_import_1_metadata,
      resultLowerFns: [_lowerFlatOwn.bind(null, 2)],
      getCallbackFn: () => null,
      getPostReturnFn: () => null,
      isCancellable: false,
      memoryIdx: null,
      getMemoryFn: () => null,
      getReallocFn: () => null,
    },
    ),
  });
  
  
  GlobalComponentAsyncLowers.define({
    componentIdx: lowered_import_2_metadata.moduleIdx,
    qualifiedImportFn: lowered_import_2_metadata.qualifiedImportFn,
    fn: _lowerImport.bind(
    null,
    {
      trampolineIdx: 6,
      componentIdx: 0,
      isAsync: false,
      paramLiftFns: [],
      metadata: lowered_import_2_metadata,
      resultLowerFns: [_lowerFlatOwn.bind(null, 1)],
      getCallbackFn: () => null,
      getPostReturnFn: () => null,
      isCancellable: false,
      memoryIdx: null,
      getMemoryFn: () => null,
      getReallocFn: () => null,
    },
    ),
  });
  
  
  GlobalComponentAsyncLowers.define({
    componentIdx: lowered_import_3_metadata.moduleIdx,
    qualifiedImportFn: lowered_import_3_metadata.qualifiedImportFn,
    fn: _lowerImport.bind(
    null,
    {
      trampolineIdx: 7,
      componentIdx: 0,
      isAsync: false,
      paramLiftFns: [_liftFlatResult([['ok', null, null],['error', null, null],])],
      metadata: lowered_import_3_metadata,
      resultLowerFns: [],
      getCallbackFn: () => null,
      getPostReturnFn: () => null,
      isCancellable: false,
      memoryIdx: null,
      getMemoryFn: () => null,
      getReallocFn: () => null,
    },
    ),
  });
  
  
  GlobalComponentAsyncLowers.define({
    componentIdx: lowered_import_4_metadata.moduleIdx,
    qualifiedImportFn: lowered_import_4_metadata.qualifiedImportFn,
    fn: _lowerImport.bind(
    null,
    {
      trampolineIdx: 8,
      componentIdx: 0,
      isAsync: false,
      paramLiftFns: [],
      metadata: lowered_import_4_metadata,
      resultLowerFns: [_lowerFlatList({ elemLowerFn: _lowerFlatTuple.bind(null, 0), typeIdx: 1 })],
      getCallbackFn: () => null,
      getPostReturnFn: () => null,
      isCancellable: false,
      memoryIdx: 0,
      getMemoryFn: () => memory0,
      getReallocFn: () => realloc0,
    },
    ),
  });
  
  
  GlobalComponentAsyncLowers.define({
    componentIdx: lowered_import_5_metadata.moduleIdx,
    qualifiedImportFn: lowered_import_5_metadata.qualifiedImportFn,
    fn: _lowerImport.bind(
    null,
    {
      trampolineIdx: 9,
      componentIdx: 0,
      isAsync: false,
      paramLiftFns: [_liftFlatBorrow.bind(null, 0)],
      metadata: lowered_import_5_metadata,
      resultLowerFns: [_lowerFlatOption.bind(null, 1)],
      getCallbackFn: () => null,
      getPostReturnFn: () => null,
      isCancellable: false,
      memoryIdx: 0,
      getMemoryFn: () => memory0,
      getReallocFn: () => null,
    },
    ),
  });
  
  
  GlobalComponentAsyncLowers.define({
    componentIdx: lowered_import_6_metadata.moduleIdx,
    qualifiedImportFn: lowered_import_6_metadata.qualifiedImportFn,
    fn: _lowerImport.bind(
    null,
    {
      trampolineIdx: 10,
      componentIdx: 0,
      isAsync: false,
      paramLiftFns: [_liftFlatBorrow.bind(null, 3),_liftFlatU64],
      metadata: lowered_import_6_metadata,
      resultLowerFns: [_lowerFlatResult([{ discriminant: 0, tag: 'ok', lowerFn: _lowerFlatOwn.bind(null, 1), align32: 4 },{ discriminant: 1, tag: 'error', lowerFn: _lowerFlatEnum.bind(null, 0), align32: 1 },])],
      getCallbackFn: () => null,
      getPostReturnFn: () => null,
      isCancellable: false,
      memoryIdx: 0,
      getMemoryFn: () => memory0,
      getReallocFn: () => null,
    },
    ),
  });
  
  
  GlobalComponentAsyncLowers.define({
    componentIdx: lowered_import_7_metadata.moduleIdx,
    qualifiedImportFn: lowered_import_7_metadata.qualifiedImportFn,
    fn: _lowerImport.bind(
    null,
    {
      trampolineIdx: 11,
      componentIdx: 0,
      isAsync: false,
      paramLiftFns: [_liftFlatBorrow.bind(null, 3)],
      metadata: lowered_import_7_metadata,
      resultLowerFns: [_lowerFlatResult([{ discriminant: 0, tag: 'ok', lowerFn: _lowerFlatOwn.bind(null, 1), align32: 4 },{ discriminant: 1, tag: 'error', lowerFn: _lowerFlatEnum.bind(null, 0), align32: 1 },])],
      getCallbackFn: () => null,
      getPostReturnFn: () => null,
      isCancellable: false,
      memoryIdx: 0,
      getMemoryFn: () => memory0,
      getReallocFn: () => null,
    },
    ),
  });
  
  
  GlobalComponentAsyncLowers.define({
    componentIdx: lowered_import_8_metadata.moduleIdx,
    qualifiedImportFn: lowered_import_8_metadata.qualifiedImportFn,
    fn: _lowerImport.bind(
    null,
    {
      trampolineIdx: 12,
      componentIdx: 0,
      isAsync: false,
      paramLiftFns: [_liftFlatBorrow.bind(null, 3)],
      metadata: lowered_import_8_metadata,
      resultLowerFns: [_lowerFlatResult([{ discriminant: 0, tag: 'ok', lowerFn: _lowerFlatEnum.bind(null, 1), align32: 1 },{ discriminant: 1, tag: 'error', lowerFn: _lowerFlatEnum.bind(null, 0), align32: 1 },])],
      getCallbackFn: () => null,
      getPostReturnFn: () => null,
      isCancellable: false,
      memoryIdx: 0,
      getMemoryFn: () => memory0,
      getReallocFn: () => null,
    },
    ),
  });
  
  
  GlobalComponentAsyncLowers.define({
    componentIdx: lowered_import_9_metadata.moduleIdx,
    qualifiedImportFn: lowered_import_9_metadata.qualifiedImportFn,
    fn: _lowerImport.bind(
    null,
    {
      trampolineIdx: 13,
      componentIdx: 0,
      isAsync: false,
      paramLiftFns: [_liftFlatBorrow.bind(null, 3)],
      metadata: lowered_import_9_metadata,
      resultLowerFns: [_lowerFlatResult([{ discriminant: 0, tag: 'ok', lowerFn: _lowerFlatRecord([{ field: 'type', lowerFn: _lowerFlatEnum.bind(null, 1), align32: 8 },{ field: 'link-count', lowerFn: _lowerFlatU64, align32: 8 },{ field: 'size', lowerFn: _lowerFlatU64, align32: 8 },{ field: 'data-access-timestamp', lowerFn: _lowerFlatOption.bind(null, 0), align32: 8 },{ field: 'data-modification-timestamp', lowerFn: _lowerFlatOption.bind(null, 0), align32: 8 },{ field: 'status-change-timestamp', lowerFn: _lowerFlatOption.bind(null, 0), align32: 8 },]), align32: 8 },{ discriminant: 1, tag: 'error', lowerFn: _lowerFlatEnum.bind(null, 0), align32: 1 },])],
      getCallbackFn: () => null,
      getPostReturnFn: () => null,
      isCancellable: false,
      memoryIdx: 0,
      getMemoryFn: () => memory0,
      getReallocFn: () => null,
    },
    ),
  });
  
  
  GlobalComponentAsyncLowers.define({
    componentIdx: lowered_import_10_metadata.moduleIdx,
    qualifiedImportFn: lowered_import_10_metadata.qualifiedImportFn,
    fn: _lowerImport.bind(
    null,
    {
      trampolineIdx: 14,
      componentIdx: 0,
      isAsync: false,
      paramLiftFns: [_liftFlatBorrow.bind(null, 1)],
      metadata: lowered_import_10_metadata,
      resultLowerFns: [_lowerFlatResult([{ discriminant: 0, tag: 'ok', lowerFn: _lowerFlatU64, align32: 8 },{ discriminant: 1, tag: 'error', lowerFn: _lowerFlatVariant({ discriminantSizeBytes: 1, lowerMetas: [{ discriminant: 0, tag: 'last-operation-failed', lowerFn: _lowerFlatOwn.bind(null, 0), align32: 4, },{ discriminant: 1, tag: 'closed', lowerFn: null, align32: null, },] }), align32: 4 },])],
      getCallbackFn: () => null,
      getPostReturnFn: () => null,
      isCancellable: false,
      memoryIdx: 0,
      getMemoryFn: () => memory0,
      getReallocFn: () => null,
    },
    ),
  });
  
  
  GlobalComponentAsyncLowers.define({
    componentIdx: lowered_import_11_metadata.moduleIdx,
    qualifiedImportFn: lowered_import_11_metadata.qualifiedImportFn,
    fn: _lowerImport.bind(
    null,
    {
      trampolineIdx: 15,
      componentIdx: 0,
      isAsync: false,
      paramLiftFns: [_liftFlatBorrow.bind(null, 1),_liftFlatList.bind(null, 0)],
      metadata: lowered_import_11_metadata,
      resultLowerFns: [_lowerFlatResult([{ discriminant: 0, tag: 'ok', lowerFn: null, align32: null },{ discriminant: 1, tag: 'error', lowerFn: _lowerFlatVariant({ discriminantSizeBytes: 1, lowerMetas: [{ discriminant: 0, tag: 'last-operation-failed', lowerFn: _lowerFlatOwn.bind(null, 0), align32: 4, },{ discriminant: 1, tag: 'closed', lowerFn: null, align32: null, },] }), align32: 4 },])],
      getCallbackFn: () => null,
      getPostReturnFn: () => null,
      isCancellable: false,
      memoryIdx: 0,
      getMemoryFn: () => memory0,
      getReallocFn: () => null,
    },
    ),
  });
  
  
  GlobalComponentAsyncLowers.define({
    componentIdx: lowered_import_12_metadata.moduleIdx,
    qualifiedImportFn: lowered_import_12_metadata.qualifiedImportFn,
    fn: _lowerImport.bind(
    null,
    {
      trampolineIdx: 16,
      componentIdx: 0,
      isAsync: false,
      paramLiftFns: [_liftFlatBorrow.bind(null, 1)],
      metadata: lowered_import_12_metadata,
      resultLowerFns: [_lowerFlatResult([{ discriminant: 0, tag: 'ok', lowerFn: null, align32: null },{ discriminant: 1, tag: 'error', lowerFn: _lowerFlatVariant({ discriminantSizeBytes: 1, lowerMetas: [{ discriminant: 0, tag: 'last-operation-failed', lowerFn: _lowerFlatOwn.bind(null, 0), align32: 4, },{ discriminant: 1, tag: 'closed', lowerFn: null, align32: null, },] }), align32: 4 },])],
      getCallbackFn: () => null,
      getPostReturnFn: () => null,
      isCancellable: false,
      memoryIdx: 0,
      getMemoryFn: () => memory0,
      getReallocFn: () => null,
    },
    ),
  });
  
  
  GlobalComponentAsyncLowers.define({
    componentIdx: lowered_import_13_metadata.moduleIdx,
    qualifiedImportFn: lowered_import_13_metadata.qualifiedImportFn,
    fn: _lowerImport.bind(
    null,
    {
      trampolineIdx: 17,
      componentIdx: 0,
      isAsync: false,
      paramLiftFns: [_liftFlatBorrow.bind(null, 1),_liftFlatList.bind(null, 0)],
      metadata: lowered_import_13_metadata,
      resultLowerFns: [_lowerFlatResult([{ discriminant: 0, tag: 'ok', lowerFn: null, align32: null },{ discriminant: 1, tag: 'error', lowerFn: _lowerFlatVariant({ discriminantSizeBytes: 1, lowerMetas: [{ discriminant: 0, tag: 'last-operation-failed', lowerFn: _lowerFlatOwn.bind(null, 0), align32: 4, },{ discriminant: 1, tag: 'closed', lowerFn: null, align32: null, },] }), align32: 4 },])],
      getCallbackFn: () => null,
      getPostReturnFn: () => null,
      isCancellable: false,
      memoryIdx: 0,
      getMemoryFn: () => memory0,
      getReallocFn: () => null,
    },
    ),
  });
  
  
  GlobalComponentAsyncLowers.define({
    componentIdx: lowered_import_14_metadata.moduleIdx,
    qualifiedImportFn: lowered_import_14_metadata.qualifiedImportFn,
    fn: _lowerImport.bind(
    null,
    {
      trampolineIdx: 18,
      componentIdx: 0,
      isAsync: false,
      paramLiftFns: [_liftFlatU64],
      metadata: lowered_import_14_metadata,
      resultLowerFns: [_lowerFlatList({ elemLowerFn: _lowerFlatU8, typeIdx: 0 })],
      getCallbackFn: () => null,
      getPostReturnFn: () => null,
      isCancellable: false,
      memoryIdx: 0,
      getMemoryFn: () => memory0,
      getReallocFn: () => realloc0,
    },
    ),
  });
  
  
  GlobalComponentAsyncLowers.define({
    componentIdx: lowered_import_15_metadata.moduleIdx,
    qualifiedImportFn: lowered_import_15_metadata.qualifiedImportFn,
    fn: _lowerImport.bind(
    null,
    {
      trampolineIdx: 19,
      componentIdx: 0,
      isAsync: false,
      paramLiftFns: [],
      metadata: lowered_import_15_metadata,
      resultLowerFns: [_lowerFlatList({ elemLowerFn: _lowerFlatTuple.bind(null, 17), typeIdx: 2 })],
      getCallbackFn: () => null,
      getPostReturnFn: () => null,
      isCancellable: false,
      memoryIdx: 0,
      getMemoryFn: () => memory0,
      getReallocFn: () => realloc0,
    },
    ),
  });
  
  Promise.all([module0, module1, module2, module3]).catch(() => {});
  ({ exports: exports0 } = yield instantiateCore(yield module2));
  ({ exports: exports1 } = yield instantiateCore(yield module0, {
    wasi_snapshot_preview1: {
      environ_get: exports0['1'],
      environ_sizes_get: exports0['2'],
      fd_write: exports0['3'],
      proc_exit: exports0['4'],
      random_get: exports0['0'],
    },
  }));
  ({ exports: exports2 } = yield instantiateCore(yield module1, {
    __main_module__: {
      cabi_realloc: exports1.cabi_realloc,
    },
    env: {
      memory: exports1.memory,
    },
    'wasi:cli/environment@0.2.3': {
      'get-environment': exports0['5'],
    },
    'wasi:cli/exit@0.2.3': {
      exit: trampoline7,
    },
    'wasi:cli/stderr@0.2.3': {
      'get-stderr': trampoline4,
    },
    'wasi:cli/stdin@0.2.3': {
      'get-stdin': trampoline5,
    },
    'wasi:cli/stdout@0.2.3': {
      'get-stdout': trampoline6,
    },
    'wasi:filesystem/preopens@0.2.2': {
      'get-directories': exports0['16'],
    },
    'wasi:filesystem/types@0.2.3': {
      '[method]descriptor.append-via-stream': exports0['8'],
      '[method]descriptor.get-type': exports0['9'],
      '[method]descriptor.stat': exports0['10'],
      '[method]descriptor.write-via-stream': exports0['7'],
      '[resource-drop]descriptor': trampoline0,
      'filesystem-error-code': exports0['6'],
    },
    'wasi:io/error@0.2.3': {
      '[resource-drop]error': trampoline2,
    },
    'wasi:io/streams@0.2.3': {
      '[method]output-stream.blocking-flush': exports0['13'],
      '[method]output-stream.blocking-write-and-flush': exports0['14'],
      '[method]output-stream.check-write': exports0['11'],
      '[method]output-stream.write': exports0['12'],
      '[resource-drop]input-stream': trampoline3,
      '[resource-drop]output-stream': trampoline1,
    },
    'wasi:random/random@0.2.3': {
      'get-random-bytes': exports0['15'],
    },
  }));
  memory0 = exports1.memory;
  GlobalComponentMemories.save({ idx: 0, componentIdx: 1, memory: memory0 });
  realloc0 = exports2.cabi_import_realloc;
  ({ exports: exports3 } = yield instantiateCore(yield module3, {
    '': {
      $imports: exports0.$imports,
      '0': exports2.random_get,
      '1': exports2.environ_get,
      '10': trampoline13,
      '11': trampoline14,
      '12': trampoline15,
      '13': trampoline16,
      '14': trampoline17,
      '15': trampoline18,
      '16': trampoline19,
      '2': exports2.environ_sizes_get,
      '3': exports2.fd_write,
      '4': exports2.proc_exit,
      '5': trampoline8,
      '6': trampoline9,
      '7': trampoline10,
      '8': trampoline11,
      '9': trampoline12,
    },
  }));
  realloc1 = exports1.cabi_realloc;
  postReturn0 = exports1.cabi_post_sign;
  postReturn1 = exports1['cabi_post_generate-keypair'];
  let exports1Sign;
  
  function sign(arg0, arg1) {
    var val0 = arg0;
    var len0 = val0.byteLength;
    var ptr0 = realloc1(0, 0, 1, len0 * 1);
    
    let valData0;
    const valLenBytes0 = len0 * 1;
    if (Array.isArray(val0)) {
      // Regular array likely containing numbers, write values to memory
      let offset = 0;
      const dv0 = new DataView(memory0.buffer);
      for (const v of val0) {
        dv0.setUint8(ptr0+ offset, v, true);
        offset += 1;
      }
    } else {
      // TypedArray / ArrayBuffer-like, direct copy
      valData0 = new Uint8Array(val0.buffer || val0, val0.byteOffset, valLenBytes0);
      const out0 = new Uint8Array(memory0.buffer, ptr0,valLenBytes0);
      out0.set(valData0);
    }
    
    var val1 = arg1;
    var len1 = val1.byteLength;
    var ptr1 = realloc1(0, 0, 1, len1 * 1);
    
    let valData1;
    const valLenBytes1 = len1 * 1;
    if (Array.isArray(val1)) {
      // Regular array likely containing numbers, write values to memory
      let offset = 0;
      const dv1 = new DataView(memory0.buffer);
      for (const v of val1) {
        dv1.setUint8(ptr1+ offset, v, true);
        offset += 1;
      }
    } else {
      // TypedArray / ArrayBuffer-like, direct copy
      valData1 = new Uint8Array(val1.buffer || val1, val1.byteOffset, valLenBytes1);
      const out1 = new Uint8Array(memory0.buffer, ptr1,valLenBytes1);
      out1.set(valData1);
    }
    
    _debugLog('[iface="sign", function="sign"][Instruction::CallWasm] enter', {
      funcName: 'sign',
      paramCount: 4,
      async: false,
      postReturn: true,
    });
    const hostProvided = false;
    
    const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
      componentIdx: 0,
      isAsync: false,
      entryFnName: 'exports1Sign',
      getCallbackFn: () => null,
      callbackFnName: 'null',
      errHandling: 'throw-result-err',
      callingWasmExport: true,
    });
    
    let ret = exports1Sign(ptr0, len0, ptr1, len1);
    endCurrentTask(0);
    let variant5;
    switch (dataView(memory0).getUint8(ret + 0, true)) {
      case 0: {
        var ptr2 = dataView(memory0).getUint32(ret + 4, true);
        var len2 = dataView(memory0).getUint32(ret + 8, true);
        var result2 = new Uint8Array(memory0.buffer.slice(ptr2, ptr2 + len2 * 1));
        variant5= {
          tag: 'ok',
          val: result2
        };
        break;
      }
      case 1: {
        let variant4;
        switch (dataView(memory0).getUint8(ret + 4, true)) {
          case 0: {
            variant4= {
              tag: 'invalid-signature',
            };
            break;
          }
          case 1: {
            variant4= {
              tag: 'unauthorized',
            };
            break;
          }
          case 2: {
            var ptr3 = dataView(memory0).getUint32(ret + 8, true);
            var len3 = dataView(memory0).getUint32(ret + 12, true);
            var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
            variant4= {
              tag: 'internal-error',
              val: result3
            };
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for HeartwoodError');
          }
        }
        variant5= {
          tag: 'err',
          val: variant4
        };
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for expected');
      }
    }
    _debugLog('[iface="sign", function="sign"][Instruction::Return]', {
      funcName: 'sign',
      paramCount: 1,
      async: false,
      postReturn: true
    });
    const retCopy = variant5;
    
    let cstate = getOrCreateAsyncState(0);
    cstate.mayLeave = false;
    postReturn0(ret);
    cstate.mayLeave = true;
    
    
    
    if (typeof retCopy === 'object' && retCopy.tag === 'err') {
      throw new ComponentError(retCopy.val);
    }
    return retCopy.val;
    
  }
  let exports1Verify;
  
  function verify(arg0, arg1, arg2) {
    var val0 = arg0;
    var len0 = val0.byteLength;
    var ptr0 = realloc1(0, 0, 1, len0 * 1);
    
    let valData0;
    const valLenBytes0 = len0 * 1;
    if (Array.isArray(val0)) {
      // Regular array likely containing numbers, write values to memory
      let offset = 0;
      const dv0 = new DataView(memory0.buffer);
      for (const v of val0) {
        dv0.setUint8(ptr0+ offset, v, true);
        offset += 1;
      }
    } else {
      // TypedArray / ArrayBuffer-like, direct copy
      valData0 = new Uint8Array(val0.buffer || val0, val0.byteOffset, valLenBytes0);
      const out0 = new Uint8Array(memory0.buffer, ptr0,valLenBytes0);
      out0.set(valData0);
    }
    
    var val1 = arg1;
    var len1 = val1.byteLength;
    var ptr1 = realloc1(0, 0, 1, len1 * 1);
    
    let valData1;
    const valLenBytes1 = len1 * 1;
    if (Array.isArray(val1)) {
      // Regular array likely containing numbers, write values to memory
      let offset = 0;
      const dv1 = new DataView(memory0.buffer);
      for (const v of val1) {
        dv1.setUint8(ptr1+ offset, v, true);
        offset += 1;
      }
    } else {
      // TypedArray / ArrayBuffer-like, direct copy
      valData1 = new Uint8Array(val1.buffer || val1, val1.byteOffset, valLenBytes1);
      const out1 = new Uint8Array(memory0.buffer, ptr1,valLenBytes1);
      out1.set(valData1);
    }
    
    var val2 = arg2;
    var len2 = val2.byteLength;
    var ptr2 = realloc1(0, 0, 1, len2 * 1);
    
    let valData2;
    const valLenBytes2 = len2 * 1;
    if (Array.isArray(val2)) {
      // Regular array likely containing numbers, write values to memory
      let offset = 0;
      const dv2 = new DataView(memory0.buffer);
      for (const v of val2) {
        dv2.setUint8(ptr2+ offset, v, true);
        offset += 1;
      }
    } else {
      // TypedArray / ArrayBuffer-like, direct copy
      valData2 = new Uint8Array(val2.buffer || val2, val2.byteOffset, valLenBytes2);
      const out2 = new Uint8Array(memory0.buffer, ptr2,valLenBytes2);
      out2.set(valData2);
    }
    
    _debugLog('[iface="verify", function="verify"][Instruction::CallWasm] enter', {
      funcName: 'verify',
      paramCount: 6,
      async: false,
      postReturn: false,
    });
    const hostProvided = false;
    
    const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
      componentIdx: 0,
      isAsync: false,
      entryFnName: 'exports1Verify',
      getCallbackFn: () => null,
      callbackFnName: 'null',
      errHandling: 'none',
      callingWasmExport: true,
    });
    
    let ret = exports1Verify(ptr0, len0, ptr1, len1, ptr2, len2);
    endCurrentTask(0);
    var bool3 = ret;
    _debugLog('[iface="verify", function="verify"][Instruction::Return]', {
      funcName: 'verify',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    return bool3 == 0 ? false : (bool3 == 1 ? true : throwInvalidBool());
  }
  let exports1GenerateKeypair;
  
  function generateKeypair() {
    _debugLog('[iface="generate-keypair", function="generate-keypair"][Instruction::CallWasm] enter', {
      funcName: 'generate-keypair',
      paramCount: 0,
      async: false,
      postReturn: true,
    });
    const hostProvided = false;
    
    const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
      componentIdx: 0,
      isAsync: false,
      entryFnName: 'exports1GenerateKeypair',
      getCallbackFn: () => null,
      callbackFnName: 'null',
      errHandling: 'none',
      callingWasmExport: true,
    });
    
    let ret = exports1GenerateKeypair();
    endCurrentTask(0);
    var ptr0 = dataView(memory0).getUint32(ret + 0, true);
    var len0 = dataView(memory0).getUint32(ret + 4, true);
    var result0 = new Uint8Array(memory0.buffer.slice(ptr0, ptr0 + len0 * 1));
    var ptr1 = dataView(memory0).getUint32(ret + 8, true);
    var len1 = dataView(memory0).getUint32(ret + 12, true);
    var result1 = new Uint8Array(memory0.buffer.slice(ptr1, ptr1 + len1 * 1));
    _debugLog('[iface="generate-keypair", function="generate-keypair"][Instruction::Return]', {
      funcName: 'generate-keypair',
      paramCount: 1,
      async: false,
      postReturn: true
    });
    const retCopy = {
      publicKey: result0,
      secretKey: result1,
    };
    
    let cstate = getOrCreateAsyncState(0);
    cstate.mayLeave = false;
    postReturn1(ret);
    cstate.mayLeave = true;
    return retCopy;
    
  }
  exports1Sign = exports1.sign;
  exports1Verify = exports1.verify;
  exports1GenerateKeypair = exports1['generate-keypair'];
  
  return { generateKeypair, sign, verify,  };
})();
let promise, resolve, reject;
function runNext (value) {
  try {
    let done;
    do {
      ({ value, done } = gen.next(value));
    } while (!(value instanceof Promise) && !done);
    if (done) {
      if (resolve) return resolve(value);
      else return value;
    }
    if (!promise) promise = new Promise((_resolve, _reject) => (resolve = _resolve, reject = _reject));
    value.then(nextVal => done ? resolve() : runNext(nextVal), reject);
  }
  catch (e) {
    if (reject) reject(e);
    else throw e;
  }
}
const maybeSyncReturn = runNext(null);
return promise || maybeSyncReturn;
}
