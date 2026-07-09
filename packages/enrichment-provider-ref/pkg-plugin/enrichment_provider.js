"use components";
export function instantiate(getCoreModule, imports, instantiateCore = WebAssembly.instantiate) {
  
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
  const symbolDispose = Symbol.dispose || Symbol.for('dispose');
  const symbolAsyncIterator = Symbol.asyncIterator;
  const symbolIterator = Symbol.iterator;
  
  const _debugLog = (...args) => {
    if (!globalThis?.process?.env?.JCO_DEBUG) { return; }
    console.debug(...args);
  };
  const ASYNC_DETERMINISM = 'random';
  const GLOBAL_COMPONENT_MEMORY_MAP = new Map();
  const CURRENT_TASK_META = {};
  
  function _getGlobalCurrentTaskMeta(componentIdx) {
    const v = CURRENT_TASK_META[componentIdx];
    if (v === undefined) { return v; }
    return { ...v };
  }
  
  function _setGlobalCurrentTaskMeta(args) {
    if (!args) { throw new TypeError('args missing'); }
    if (args.taskID === undefined) { throw new TypeError('missing task ID'); }
    if (args.componentIdx === undefined) { throw new TypeError('missing component idx'); }
    const { taskID, componentIdx } = args;
    return CURRENT_TASK_META[componentIdx] = { taskID, componentIdx };
  }
  
  function _withGlobalCurrentTaskMeta(args) {
    _debugLog('[_withGlobalCurrentTaskMeta()] args', args);
    if (!args) { throw new TypeError('args missing'); }
    if (args.taskID === undefined) { throw new TypeError('missing task ID'); }
    if (args.componentIdx === undefined) { throw new TypeError('missing component idx'); }
    if (!args.fn) { throw new TypeError('missing fn'); }
    const { taskID, componentIdx, fn } = args;
    
    try {
      CURRENT_TASK_META[componentIdx] = { taskID, componentIdx };
      return fn();
    } catch (err) {
      _debugLog("error while executing sync callee/callback", {
        ...args,
        err,
      });
      throw err;
    } finally {
      CURRENT_TASK_META[componentIdx] = null;
    }
  }
  
  async function _withGlobalCurrentTaskMetaAsync(args) {
    _debugLog('[_withGlobalCurrentTaskMetaAsync()] args', args);
    if (!args) { throw new TypeError('args missing'); }
    if (args.taskID === undefined) { throw new TypeError('missing task ID'); }
    if (args.componentIdx === undefined) { throw new TypeError('missing component idx'); }
    if (!args.fn) { throw new TypeError('missing fn'); }
    const { taskID, componentIdx, fn } = args;
    
    // If there is already an async task executing, we must wait for it
    // to complete before we can can run the closure we were given
    //
    let current = CURRENT_TASK_META[componentIdx];
    let cstate;
    if (current && current.taskID !== taskID) {
      cstate = getOrCreateAsyncState(componentIdx);
      while (current && current.taskID !== taskID) {
        const { promise, resolve } = Promise.withResolvers();
        cstate.onNextExclusiveRelease(resolve);
        await promise;
        current = CURRENT_TASK_META[componentIdx];
      }
      
      // Since we've just waited for the component to not be locked, re-lock
      // exclusivity so we can run the fn below (likely a callee/callback)
      cstate.exclusiveLock();
    }
    
    try {
      CURRENT_TASK_META[componentIdx] = { taskID, componentIdx };
      return await fn();
    } catch (err) {
      _debugLog("error while executing async callee/callback", {
        ...args,
        err,
      });
      throw err;
    } finally {
      CURRENT_TASK_META[componentIdx] = null;
    }
  }
  
  async function _clearCurrentTask(args) {
    _debugLog('[_clearCurrentTask()] args', args);
    if (!args) { throw new TypeError('args missing'); }
    if (args.taskID === undefined) { throw new TypeError('missing task ID'); }
    if (args.componentIdx === undefined) { throw new TypeError('missing component idx'); }
    const { taskID, componentIdx } = args;
    
    const meta = CURRENT_TASK_META[componentIdx];
    if (!meta) { throw new Error(`missing current task meta for component idx [${componentIdx}]n`); }
    
    if (meta.taskID !== taskID) {
      throw new Error(`task ID [${meta.taskID}] != requested ID [${taskID}]`);
    }
    if (meta.componentIdx !== componentIdx) {
      throw new Error(`component idx [${meta.componentIdx}] != requested idx [${componentIdx}]`);
    }
    
    CURRENT_TASK_META[componentIdx] = null;
  }
  
  function lookupMemoriesForComponent(args) {
    const { componentIdx } = args ?? {};
    if (args.componentIdx === undefined) { throw new TypeError("missing component idx"); }
    
    const metas = GLOBAL_COMPONENT_MEMORY_MAP.get(componentIdx);
    if (!metas) { return []; }
    
    if (args.memoryIdx === undefined) {
      return Object.values(metas);
    }
    
    const meta = metas[args.memoryIdx];
    return meta?.memory;
  }
  
  function registerGlobalMemoryForComponent(args) {
    const { componentIdx, memory, memoryIdx } = args ?? {};
    if (componentIdx === undefined) { throw new TypeError('missing component idx'); }
    if (memory === undefined && memoryIdx === undefined) { throw new TypeError('missing both memory & memory idx'); }
    let inner = GLOBAL_COMPONENT_MEMORY_MAP.get(componentIdx);
    if (!inner) {
      inner = {};
      GLOBAL_COMPONENT_MEMORY_MAP.set(componentIdx, inner);
    }
    
    inner[memoryIdx] = { memory, memoryIdx, componentIdx };
  }
  
  class RepTable {
    #data = [0, null];
    #target;
    
    constructor(args) {
      this.target = args?.target;
    }
    
    data() { return this.#data; }
    
    insert(val) {
      _debugLog('[RepTable#insert()] args', { val, target: this.target });
      const freeIdx = this.#data[0];
      if (freeIdx === 0) {
        this.#data.push(val);
        this.#data.push(null);
        const rep = (this.#data.length >> 1) - 1;
        _debugLog('[RepTable#insert()] inserted', { val, target: this.target, rep });
        return rep;
      }
      this.#data[0] = this.#data[freeIdx << 1];
      const placementIdx = freeIdx << 1;
      this.#data[placementIdx] = val;
      this.#data[placementIdx + 1] = null;
      _debugLog('[RepTable#insert()] inserted', { val, target: this.target, rep: freeIdx });
      return freeIdx;
    }
    
    get(rep) {
      _debugLog('[RepTable#get()] args', { rep, target: this.target });
      if (rep === 0) { throw new Error('invalid resource rep during get, (cannot be 0)'); }
      
      const baseIdx = rep << 1;
      const val = this.#data[baseIdx];
      return val;
    }
    
    contains(rep) {
      _debugLog('[RepTable#contains()] args', { rep, target: this.target });
      if (rep === 0) { throw new Error('invalid resource rep during contains, (cannot be 0)'); }
      
      const baseIdx = rep << 1;
      return !!this.#data[baseIdx];
    }
    
    remove(rep) {
      _debugLog('[RepTable#remove()] args', { rep, target: this.target });
      if (rep === 0) { throw new Error('invalid resource rep during remove, (cannot be 0)'); }
      if (this.#data.length === 2) { throw new Error('invalid'); }
      
      const baseIdx = rep << 1;
      const val = this.#data[baseIdx];
      
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
  
  function _isValidNumericPrimitive(ty, v) {
    if (v === undefined || v === null) { return false; }
    switch (ty) {
      case 'bool':
      return v === 0 || v === 1;
      break;
      case 'u8':
      return v >= 0 && v <= 255;
      break;
      case 's8':
      return v >= -128 && v <= 127;
      break;
      case 'u16':
      return v >= 0 && v <= 65535;
      break;
      case 's16':
      return v >= -32768 && v <= 32767;
      case 'u32':
      return v >= 0 && v <= 4_294_967_295;
      case 's32':
      return v >= -2_147_483_648 && v <= 2_147_483_647;
      case 'u64':
      return typeof v === 'bigint' && v >= 0 && v <= 18_446_744_073_709_551_615n;
      case 's64':
      return typeof v === 'bigint' && v >= -9223372036854775808n && v <= 9223372036854775807n;
      break;
      case 'f32':
      case 'f64': return typeof v === 'number';
      default:
      return false;
    }
    return true;
  }
  
  function _requireValidNumericPrimitive(ty, v) {
    if (v === undefined  || v === null || !_isValidNumericPrimitive(ty, v)) {
      throw new TypeError(`invalid ${ty} value [${v}]`);
    }
    return true;
  }
  const _typeCheckValidI32 = (n) => typeof n === 'number' && n >= I32_MIN && n <= I32_MAX;
  
  const _typeCheckAsyncFn= (f) => {
    return f instanceof ASYNC_FN_CTOR;
  };
  
  let RESOURCE_CALL_BORROWS = [];const ASYNC_FN_CTOR = (async () => {}).constructor;
  
  function clearCurrentTask(componentIdx, taskID) {
    _debugLog('[clearCurrentTask()] args', { componentIdx, taskID });
    
    if (componentIdx === undefined || componentIdx === null) {
      throw new Error('missing/invalid component instance index while ending current task');
    }
    
    const tasks = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx);
    if (!tasks || !Array.isArray(tasks)) {
      throw new Error('missing/invalid tasks for component instance while ending task');
    }
    if (tasks.length == 0) {
      throw new Error(`no current tasks for component instance [${componentIdx}] while ending task`);
    }
    
    if (taskID !== undefined) {
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
  const CURRENT_TASK_MAY_BLOCK = new WebAssembly.Global({ value: 'i32', mutable: true }, 0);
  const ASYNC_CURRENT_TASK_IDS = [];
  const ASYNC_CURRENT_COMPONENT_IDXS = [];
  
  function unpackCallbackResult(result) {
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
  
  class AsyncSubtask {
    static _ID = 0n;
    
    static State = {
      STARTING: 0,
      STARTED: 1,
      RETURNED: 2,
      CANCELLED_BEFORE_STARTED: 3,
      CANCELLED_BEFORE_RETURNED: 4,
    };
    
    #id;
    #state = AsyncSubtask.State.STARTING;
    #componentIdx;
    
    #parentTask;
    #childTask = null;
    
    #dropped = false;
    #cancelRequested = false;
    
    #memoryIdx = null;
    #lenders = null;
    
    #waitable = null;
    
    #callbackFn = null;
    #callbackFnName = null;
    
    #postReturnFn = null;
    #onProgressFn = null;
    #pendingEventFn = null;
    
    #callMetadata = {};
    
    #resolved = false;
    
    #onResolveHandlers = [];
    #onStartHandlers = [];
    
    #result = null;
    #resultSet = false;
    
    fnName;
    target;
    isAsync;
    isManualAsync;
    
    constructor(args) {
      if (typeof args.componentIdx !== 'number') {
        throw new Error('invalid componentIdx for subtask creation');
      }
      this.#componentIdx = args.componentIdx;
      
      this.#id = ++AsyncSubtask._ID;
      this.fnName = args.fnName;
      
      if (!args.parentTask) { throw new Error('missing parent task during subtask creation'); }
      this.#parentTask = args.parentTask;
      
      if (args.childTask) { this.#childTask = args.childTask; }
      
      if (args.memoryIdx) { this.#memoryIdx = args.memoryIdx; }
      
      if (!args.waitable) { throw new Error("missing/invalid waitable"); }
      this.#waitable = args.waitable;
      
      if (args.callMetadata) { this.#callMetadata = args.callMetadata; }
      
      this.#lenders = [];
      this.target = args.target;
      this.isAsync = args.isAsync;
      this.isManualAsync = args.isManualAsync;
    }
    
    id() { return this.#id; }
    parentTaskID() { return this.#parentTask?.id(); }
    childTaskID() { return this.#childTask?.id(); }
    state() { return this.#state; }
    
    waitable() { return this.#waitable; }
    waitableRep() { return this.#waitable.idx(); }
    
    join() { return this.#waitable.join(...arguments); }
    getPendingEvent() { return this.#waitable.getPendingEvent(...arguments); }
    hasPendingEvent() { return this.#waitable.hasPendingEvent(...arguments); }
    setPendingEvent() { return this.#waitable.setPendingEvent(...arguments); }
    
    setTarget(tgt) { this.target = tgt; }
    
    getResult() {
      if (!this.#resultSet) { throw new Error("subtask result has not been set") }
      return this.#result;
    }
    setResult(v) {
      if (this.#resultSet) { throw new Error("subtask result has already been set"); }
      this.#result = v;
      this.#resultSet = true;
    }
    
    componentIdx() { return this.#componentIdx; }
    
    setChildTask(t) {
      if (!t) { throw new Error('cannot set missing/invalid child task on subtask'); }
      if (this.#childTask) { throw new Error('child task is already set on subtask'); }
      if (this.#parentTask === t) { throw new Error("parent cannot be child"); }
      this.#childTask = t;
    }
    getChildTask(t) { return this.#childTask; }
    
    getParentTask() { return this.#parentTask; }
    
    setCallbackFn(f, name) {
      if (!f) { return; }
      if (this.#callbackFn) { throw new Error('callback fn can only be set once'); }
      this.#callbackFn = f;
      this.#callbackFnName = name;
    }
    
    getCallbackFnName() {
      if (!this.#callbackFn) { return undefined; }
      return this.#callbackFn.name;
    }
    
    setPostReturnFn(f) {
      if (!f) { return; }
      if (this.#postReturnFn) { throw new Error('postReturn fn can only be set once'); }
      this.#postReturnFn = f;
    }
    
    setOnProgressFn(f) {
      if (this.#onProgressFn) { throw new Error('on progress fn can only be set once'); }
      this.#onProgressFn = f;
    }
    
    isNotStarted() {
      return this.#state == AsyncSubtask.State.STARTING;
    }
    
    registerOnStartHandler(f) {
      this.#onStartHandlers.push(f);
    }
    
    onStart(args) {
      _debugLog('[AsyncSubtask#onStart()] args', {
        componentIdx: this.#componentIdx,
        subtaskID: this.#id,
        parentTaskID: this.parentTaskID(),
        fnName: this.fnName,
      });
      
      if (this.#onProgressFn) { this.#onProgressFn(); }
      
      this.#state = AsyncSubtask.State.STARTED;
      
      let result;
      
      // If we have been provided a helper start function as a result of
      // component fusion performed by wasmtime tooling, then we can call that helper and lifts/lowers will
      // be performed for us.
      //
      // See also documentation on `HostIntrinsic::PrepareCall`
      //
      if (this.#callMetadata.startFn) {
        result = this.#callMetadata.startFn.apply(null, args?.startFnParams ?? []);
      }
      
      return result;
    }
    
    
    registerOnResolveHandler(f) {
      this.#onResolveHandlers.push(f);
    }
    
    reject(subtaskErr) {
      this.#childTask?.reject(subtaskErr);
    }
    
    onResolve(subtaskValue) {
      _debugLog('[AsyncSubtask#onResolve()] args', {
        componentIdx: this.#componentIdx,
        subtaskID: this.#id,
        isAsync: this.isAsync,
        childTaskID: this.childTaskID(),
        parentTaskID: this.parentTaskID(),
        parentTaskFnName: this.#parentTask?.entryFnName(),
        fnName: this.fnName,
      });
      
      if (this.#resolved) {
        throw new Error('subtask has already been resolved');
      }
      
      if (this.#onProgressFn) { this.#onProgressFn(); }
      
      if (subtaskValue === null) {
        if (this.#cancelRequested) {
          throw new Error('cancel was not requested, but no value present at return');
        }
        
        if (this.#state === AsyncSubtask.State.STARTING) {
          this.#state = AsyncSubtask.State.CANCELLED_BEFORE_STARTED;
        } else {
          if (this.#state !== AsyncSubtask.State.STARTED) {
            throw new Error('resolved subtask must have been started before cancellation');
          }
          this.#state = AsyncSubtask.State.CANCELLED_BEFORE_RETURNED;
        }
      } else {
        if (this.#state !== AsyncSubtask.State.STARTED) {
          throw new Error('resolved subtask must have been started before completion');
        }
        this.#state = AsyncSubtask.State.RETURNED;
      }
      
      this.setResult(subtaskValue);
      
      for (const f of this.#onResolveHandlers) {
        try {
          f(subtaskValue);
        } catch (err) {
          console.error("error during subtask resolve handler", err);
          throw err;
        }
      }
      
      const callMetadata = this.getCallMetadata();
      
      // TODO(fix): we should be able to easily have the caller's meomry
      // to lower into here, but it's not present in PrepareCall
      const memory = callMetadata.memory ?? this.#parentTask?.getReturnMemory() ?? lookupMemoriesForComponent({ componentIdx: this.#parentTask?.componentIdx() })[0];
      if (callMetadata && !callMetadata.returnFn && this.isAsync && callMetadata.resultPtr && memory) {
        const { resultPtr, realloc } = callMetadata;
        const lowers = callMetadata.lowers; // may have been updated in task.return of the child
        if (lowers && lowers.length > 0) {
          lowers[0]({
            componentIdx: this.#componentIdx,
            memory,
            realloc,
            vals: [subtaskValue],
            storagePtr: resultPtr,
            stringEncoding: callMetadata.stringEncoding,
          });
        }
      }
      
      this.#resolved = true;
      this.#parentTask.removeSubtask(this);
    }
    
    getStateNumber() { return this.#state; }
    isReturned() { return this.#state === AsyncSubtask.State.RETURNED; }
    
    getCallMetadata() { return this.#callMetadata; }
    
    isResolved() {
      if (this.#state === AsyncSubtask.State.STARTING
      || this.#state === AsyncSubtask.State.STARTED) {
        return false;
      }
      if (this.#state === AsyncSubtask.State.RETURNED
      || this.#state === AsyncSubtask.State.CANCELLED_BEFORE_STARTED
      || this.#state === AsyncSubtask.State.CANCELLED_BEFORE_RETURNED) {
        return true;
      }
      throw new Error('unrecognized internal Subtask state [' + this.#state + ']');
    }
    
    addLender(handle) {
      _debugLog('[AsyncSubtask#addLender()] args', { handle });
      if (!Number.isNumber(handle)) { throw new Error('missing/invalid lender handle [' + handle + ']'); }
      
      if (this.#lenders.length === 0 || this.isResolved()) {
        throw new Error('subtask has no lendors or has already been resolved');
      }
      
      handle.lends++;
      this.#lenders.push(handle);
    }
    
    deliverResolve() {
      _debugLog('[AsyncSubtask#deliverResolve()] args', {
        lenders: this.#lenders,
        parentTaskID: this.parentTaskID(),
        subtaskID: this.#id,
        childTaskID: this.childTaskID(),
        resolved: this.isResolved(),
        resolveDelivered: this.resolveDelivered(),
      });
      
      const cannotDeliverResolve = this.resolveDelivered() || !this.isResolved();
      if (cannotDeliverResolve) {
        throw new Error('subtask cannot deliver resolution twice, and the subtask must be resolved');
      }
      
      for (const lender of this.#lenders) {
        lender.lends--;
      }
      
      this.#lenders = null;
    }
    
    resolveDelivered() {
      _debugLog('[AsyncSubtask#resolveDelivered()] args', { });
      if (this.#lenders === null && !this.isResolved()) {
        throw new Error('invalid subtask state, lenders missing and subtask has not been resolved');
      }
      return this.#lenders === null;
    }
    
    drop() {
      _debugLog('[AsyncSubtask#drop()] args', {
        componentIdx: this.#componentIdx,
        parentTaskID: this.#parentTask?.id(),
        parentTaskFnName: this.#parentTask?.entryFnName(),
        childTaskID: this.#childTask?.id(),
        childTaskFnName: this.#childTask?.entryFnName(),
        subtaskFnName: this.fnName,
      });
      if (!this.#waitable) { throw new Error('missing/invalid inner waitable'); }
      if (!this.resolveDelivered()) {
        throw new Error('cannot drop subtask before resolve is delivered');
      }
      if (this.#waitable) { this.#waitable.drop() }
      this.#dropped = true;
    }
    
    #getComponentState() {
      const state = getOrCreateAsyncState(this.#componentIdx);
      if (!state) {
        throw new Error('invalid/missing async state for component [' + componentIdx + ']');
      }
      return state;
    }
    
    getWaitableHandleIdx() {
      _debugLog('[AsyncSubtask#getWaitableHandleIdx()] args', { });
      if (!this.#waitable) { throw new Error('missing/invalid waitable'); }
      return this.waitableRep();
    }
  }
  
  function _prepareCall(
  memoryIdx,
  getMemoryFn,
  startFn,
  returnFn,
  callerComponentIdx,
  calleeComponentIdx,
  taskReturnTypeIdx,
  calleeIsAsyncInt,
  stringEncoding,
  resultCountOrAsync,
  ) {
    _debugLog('[_prepareCall()]', {
      memoryIdx,
      callerComponentIdx,
      calleeComponentIdx,
      taskReturnTypeIdx,
      calleeIsAsyncInt,
      stringEncoding,
      resultCountOrAsync,
    });
    const argArray = [...arguments];
    
    // value passed in *may* be as large as u32::MAX which may be mangled into -2
    resultCountOrAsync >>>= 0;
    
    let isAsync = false;
    let hasResultPointer = false;
    if (resultCountOrAsync === 2**32 - 1) {
      // prepare async with no result (u32::MAX)
      isAsync = true;
      hasResultPointer = false;
    } else if (resultCountOrAsync === 2**32 - 2) {
      // prepare async with result (u32::MAX - 1)
      isAsync = true;
      hasResultPointer = true;
    }
    
    const currentCallerTaskMeta = getCurrentTask(callerComponentIdx);
    if (!currentCallerTaskMeta) {
      throw new Error('invalid/missing current task for caller during prepare call');
    }
    
    const currentCallerTask = currentCallerTaskMeta.task;
    if (!currentCallerTask) {
      throw new Error('unexpectedly missing task in meta for caller during prepare call');
    }
    
    if (currentCallerTask.componentIdx() !== callerComponentIdx) {
      throw new Error(`task component idx [${ currentCallerTask.componentIdx() }] !== [${ callerComponentIdx }] (callee ${ calleeComponentIdx })`);
    }
    
    let getCalleeParamsFn;
    let resultPtr = null;
    let directParamsArr;
    if (hasResultPointer) {
      directParamsArr = argArray.slice(10, argArray.length - 1);
      getCalleeParamsFn = () => directParamsArr;
      resultPtr = argArray[argArray.length - 1];
    } else {
      directParamsArr = argArray.slice(10);
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
    
    const subtask = currentCallerTask.createSubtask({
      componentIdx: callerComponentIdx,
      parentTask: currentCallerTask,
      isAsync,
      callMetadata: {
        getMemoryFn,
        memoryIdx,
        resultPtr,
        returnFn,
        startFn,
        stringEncoding,
      }
    });
    
    const [newTask, newTaskID] = createNewCurrentTask({
      componentIdx: calleeComponentIdx,
      isAsync,
      getCalleeParamsFn,
      entryFnName: [
      'task',
      subtask.getParentTask().id(),
      'subtask',
      subtask.id(),
      'new-prepared-async-task'
      ].join('/'),
      stringEncoding,
    });
    newTask.setParentSubtask(subtask);
    newTask.setReturnMemoryIdx(memoryIdx);
    newTask.setReturnMemory(getMemoryFn);
    subtask.setChildTask(newTask);
    
    newTask.subtaskMeta = {
      subtask,
      calleeComponentIdx,
      callerComponentIdx,
      getCalleeParamsFn,
      stringEncoding,
      isAsync,
    };
    
    _setGlobalCurrentTaskMeta({
      taskID: newTask.id(),
      componentIdx: newTask.componentIdx(),
    });
  }
  
  function _asyncStartCall(args, callee, paramCount, resultCount, flags) {
    const componentIdx = ASYNC_CURRENT_COMPONENT_IDXS.at(-1);
    
    const globalTaskMeta = _getGlobalCurrentTaskMeta(componentIdx);
    if (!globalTaskMeta) { throw new Error('missing global current task globalTaskMeta'); }
    const taskID = globalTaskMeta.taskID;
    
    _debugLog('[_asyncStartCall()] args', { args, componentIdx });
    const { getCallbackFn, callbackIdx, getPostReturnFn, postReturnIdx } = args;
    
    const preparedTaskMeta = getCurrentTask(componentIdx, taskID);
    if (!preparedTaskMeta) { throw new Error('unexpectedly missing current task'); }
    
    const preparedTask = preparedTaskMeta.task;
    if (!preparedTask) { throw new Error('unexpectedly missing current task'); }
    if (!preparedTask.subtaskMeta) { throw new Error('missing subtask meta from prepare'); }
    
    const {
      subtask,
      returnMemoryIdx,
      getReturnMemoryFn,
      callerComponentIdx,
      calleeComponentIdx,
      getCalleeParamsFn,
      isAsync,
      stringEncoding,
    } = preparedTask.subtaskMeta;
    if (!subtask) { throw new Error("missing subtask from cstate during async start call"); }
    if (calleeComponentIdx !== preparedTask.componentIdx()) {
      throw new Error(`meta callee idx [${calleeComponentIdx}] != current task idx [${preparedTask.componentIdx()}] during async start call`);
    }
    if (calleeComponentIdx !== componentIdx) {
      throw new Error("mismatched componentIdx for async start call (does not match prepare)");
    }
    
    const argArray = [...arguments];
    
    if (resultCount < 0 || resultCount > 1) { throw new Error('invalid/unsupported result count'); }
    
    const callbackFnName = 'callback_' + callbackIdx;
    const callbackFn = getCallbackFn();
    preparedTask.setCallbackFn(callbackFn, callbackFnName);
    preparedTask.setPostReturnFn(getPostReturnFn());
    
    if (resultCount < 0 || resultCount > 1) {
      throw new Error(`unsupported result count [${ resultCount }]`);
    }
    
    const params = preparedTask.getCalleeParams();
    if (paramCount !== params.length) {
      throw new Error(`unexpected callee param count [${ params.length }], _asyncStartCall invocation expected [${ paramCount }]`);
    }
    
    const callerComponentState = getOrCreateAsyncState(subtask.componentIdx());
    
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
      if (subtaskCallMeta && subtaskCallMeta.returnFn) {
        _debugLog('[_asyncStartCall()] return function present while handling subtask result, returning early (skipping lower)');
        
        // TODO: centralize calling of returnFn to *one place* (if possible)
        if (subtaskCallMeta.returnFnCalled) { return; }
        
        subtaskCallMeta.returnFn.apply(null, [subtaskCallMeta.resultPtr]);
        return;
      }
      
      // If there is no where to lower the results, exit early
      if (!subtaskCallMeta.resultPtr) {
        _debugLog('[_asyncStartCall()] no result ptr during subtask result handling, returning early (skipping lower)');
        return;
      }
      
      let callerMemory;
      if (callerMemoryIdx !== null && callerMemoryIdx !== undefined) {
        callerMemory = lookupMemoriesForComponent({ componentIdx: callerComponentIdx, memoryIdx: callerMemoryIdx });
      } else {
        const callerMemories = lookupMemoriesForComponent({ componentIdx: callerComponentIdx });
        if (callerMemories.length !== 1) { throw new Error(`unsupported amount of caller memories`); }
        callerMemory = callerMemories[0];
      }
      
      if (!callerMemory) {
        _debugLog('[_asyncStartCall()] missing memory', { subtaskID: subtask.id(), res });
        throw new Error(`missing memory for to guest->guest call result (subtask [${subtask.id()}])`);
      }
      
      const lowerFns = calleeTask.getReturnLowerFns();
      if (!lowerFns || lowerFns.length === 0) {
        _debugLog('[_asyncStartCall()] missing result lower metadata for guest->guest call', { subtaskID: subtask.id() });
        throw new Error(`missing result lower metadata for guest->guest call (subtask [${subtask.id()}])`);
      }
      
      if (lowerFns.length !== 1) {
        _debugLog('[_asyncStartCall()] only single result reportetd for guest->guest call', { subtaskID: subtask.id() });
        throw new Error(`only single result supported for guest->guest calls (subtask [${subtask.id()}])`);
      }
      
      _debugLog('[_asyncStartCall()] lowering results', { subtaskID: subtask.id() });
      lowerFns[0]({
        realloc: undefined,
        memory: callerMemory,
        vals: [res],
        storagePtr: subtaskCallMeta.resultPtr,
        componentIdx: callerComponentIdx,
        stringEncoding: subtaskCallMeta.stringEncoding,
      });
      
    });
    
    subtask.setOnProgressFn(() => {
      subtask.setPendingEvent(() => {
        if (subtask.isResolved()) { subtask.deliverResolve(); }
        const event = {
          code: ASYNC_EVENT_CODE.SUBTASK,
          payload0: subtask.waitableRep(),
          payload1: subtask.getStateNumber(),
        };
        return event;
      });
    });
    
    // Start the (event) driver loop that will resolve the task
    queueMicrotask(async () => {
      let startRes = subtask.onStart({ startFnParams: params });
      startRes = Array.isArray(startRes) ? startRes : [startRes];
      
      await calleeComponentState.suspendTask({
        task: preparedTask,
        readyFn: () => !calleeComponentState.isExclusivelyLocked(),
      });
      
      const started = await preparedTask.enter();
      if (!started) {
        _debugLog('[_asyncStartCall()] task failed early', {
          taskID: preparedTask.id(),
          subtaskID: subtask.id(),
        });
        throw new Error("task failed to start");
        return;
      }
      
      let callbackResult;
      try {
        let jspiCallee = WebAssembly.promising(callee);
        callbackResult = await _withGlobalCurrentTaskMetaAsync({
          taskID: preparedTask.id(),
          componentIdx: preparedTask.componentIdx(),
          fn: () => {
            return jspiCallee.apply(null, startRes);
          }
        });
      } catch(err) {
        _debugLog("[_asyncStartCall()] initial subtask callee run failed", err);
        // NOTE: a good place to rejectt the parent task, if rejection API is enabled
        // subtask.reject(err);
        // subtask.getParentTask().reject(err);
        
        subtask.getParentTask().setErrored(err);
        
        return;
      }
      
      // If there was no callback function, we're dealing with a sync function
      // that was lifted as async without one, there is only the callee.
      if (!callbackFn) {
        _debugLog("[_asyncStartCall()] no callback, resolving w/ callee result", {
          taskID: preparedTask.id(),
          componentIdx: preparedTask.componentIdx(),
          preparedTask,
          stateNumber: preparedTask.taskState(),
          isResolved: preparedTask.isResolved(),
          callbackFn,
        });
        preparedTask.resolve([callbackResult]);
        return;
      }
      
      let fnName = callbackFn.fnName;
      if (!fnName) {
        fnName = [
        '<task ',
        subtask.parentTaskID(),
        '/subtask ',
        subtask.id(),
        '/task ',
        preparedTask.id(),
        '>',
        ].join("");
      }
      
      try {
        _debugLog("[_asyncStartCall()] starting driver loop", {
          fnName,
          componentIdx: preparedTask.componentIdx(),
          subtaskID: subtask.id(),
          childTaskID: subtask.childTaskID(),
          parentTaskID: subtask.parentTaskID(),
        });
        
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
    
    const subtaskState = subtask.getStateNumber();
    if (subtaskState < 0 || subtaskState > 2**5) {
      throw new Error('invalid subtask state, out of valid range');
    }
    
    _debugLog('[_asyncStartCall()] returning subtask rep & state', {
      subtask: {
        rep: subtask.waitableRep(),
        state: subtaskState,
      }
    });
    
    return Number(subtask.waitableRep()) << 4 | subtaskState;
  }
  
  function _syncStartCall(callbackIdx) {
    _debugLog('[_syncStartCall()] args', { callbackIdx });
    throw new Error('synchronous start call not implemented!');
  }
  
  class Waitable {
    #componentIdx;
    
    #pendingEventFn = null;
    
    #promise;
    #resolve;
    #reject;
    
    #waitableSet = null;
    
    #idx = null; // to component-global waitables
    
    target;
    
    constructor(args) {
      const { componentIdx, target } = args;
      this.#componentIdx = componentIdx;
      this.target = args.target;
      this.#resetPromise();
    }
    
    componentIdx() { return this.#componentIdx; }
    isInSet() { return this.#waitableSet !== null; }
    
    idx() { return this.#idx; }
    setIdx(idx) {
      if (idx === 0) { throw new Error("waitable idx cannot be zero"); }
      this.#idx = idx;
    }
    
    setTarget(tgt) { this.target = tgt; }
    
    #resetPromise() {
      const { promise, resolve, reject } = promiseWithResolvers()
      this.#promise = promise;
      this.#resolve = resolve;
      this.#reject = reject;
    }
    
    resolve() { this.#resolve(); }
    reject(err) { this.#reject(err); }
    promise() { return this.#promise; }
    
    hasPendingEvent() {
      // _debugLog('[Waitable#hasPendingEvent()]', {
        //     componentIdx: this.#componentIdx,
        //     waitable: this,
        //     waitableSet: this.#waitableSet,
        //     hasPendingEvent: this.#pendingEventFn !== null,
        // });
        return this.#pendingEventFn !== null;
      }
      
      setPendingEvent(fn) {
        _debugLog('[Waitable#setPendingEvent()] args', {
          waitable: this,
          inSet: this.#waitableSet,
        });
        this.#pendingEventFn = fn;
      }
      
      getPendingEvent() {
        _debugLog('[Waitable#getPendingEvent()] args', {
          waitable: this,
          inSet: this.#waitableSet,
          hasPendingEvent: this.#pendingEventFn !== null,
        });
        if (this.#pendingEventFn === null) { return null; }
        const eventFn = this.#pendingEventFn;
        this.#pendingEventFn = null;
        const e = eventFn();
        this.#resetPromise();
        return e;
      }
      
      join(waitableSet) {
        _debugLog('[Waitable#join()] args', {
          waitable: this,
          waitableSet: waitableSet,
        });
        if (this.#waitableSet) { this.#waitableSet.removeWaitable(this); }
        if (!waitableSet) {
          this.#waitableSet = null;
          return;
        }
        waitableSet.addWaitable(this);
        this.#waitableSet = waitableSet;
      }
      
      drop() {
        _debugLog('[Waitable#drop()] args', {
          componentIdx: this.#componentIdx,
          waitable: this,
        });
        if (this.hasPendingEvent()) {
          throw new Error('waitables with pending events cannot be dropped');
        }
        this.join(null);
      }
      
    }
    
    const ERR_CTX_TABLES = {};
    
    let dv = new DataView(new ArrayBuffer());
    const dataView = mem => dv.buffer === mem.buffer ? dv : dv = new DataView(mem.buffer);
    const utf16Decoder = new TextDecoder('utf-16');
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
      const res = { ptr, len: buf.length, codepoints: [...s].length };
      return res;
    }
    
    
    function getCurrentTask(componentIdx, taskID) {
      let usedGlobal = false;
      if (componentIdx === undefined || componentIdx === null) {
        throw new Error('missing component idx'); // TODO(fix)
        // componentIdx = ASYNC_CURRENT_COMPONENT_IDXS.at(-1);
        // usedGlobal = true;
      }
      
      const taskMetas = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx);
      if (taskMetas === undefined || taskMetas.length === 0) { return undefined; }
      
      if (taskID) {
        return taskMetas.find(meta => meta.task.id() === taskID);
      }
      
      const taskMeta = taskMetas[taskMetas.length - 1];
      if (!taskMeta || !taskMeta.task) { return undefined; }
      
      return taskMeta;
    }
    
    function createNewCurrentTask(args) {
      _debugLog('[createNewCurrentTask()] args', args);
      const {
        componentIdx,
        isAsync,
        isManualAsync,
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
      let taskMetas = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx);
      const callbackFn = getCallbackFn ? getCallbackFn() : null;
      
      const newTask = new AsyncTask({
        componentIdx,
        isAsync,
        isManualAsync,
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
      
      // NOTE: do not track host tasks
      ASYNC_CURRENT_TASK_IDS.push(newTaskID);
      ASYNC_CURRENT_COMPONENT_IDXS.push(componentIdx);
      
      if (!taskMetas) {
        taskMetas = [newTaskMeta];
        ASYNC_TASKS_BY_COMPONENT_IDX.set(componentIdx, [newTaskMeta]);
      } else {
        taskMetas.push(newTaskMeta);
      }
      
      return [newTask, newTaskID];
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
      #isManualAsync;
      #entryFnName = null;
      
      #onResolveHandlers = [];
      #completionPromise = null;
      #rejected = false;
      
      #exitPromise = null;
      #onExitHandlers = [];
      
      #memoryIdx = null;
      #memory = null;
      
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
      
      #subtasks = [];
      
      #entered = false;
      #exited = false;
      #errored = null;
      
      cancelled = false;
      cancelRequested = false;
      alwaysTaskReturn = false;
      
      returnCalls =  0;
      storage = [0, 0];
      borrowedHandles = {};
      
      tmpRetI64HighBits = 0|0;
      
      constructor(opts) {
        this.#id = ++AsyncTask._ID;
        
        if (opts?.componentIdx === undefined) {
          throw new TypeError('missing component id during task creation');
        }
        this.#componentIdx = opts.componentIdx;
        
        this.#state = AsyncTask.State.INITIAL;
        this.#isAsync = opts?.isAsync ?? false;
        this.#isManualAsync = opts?.isManualAsync ?? false;
        this.#entryFnName = opts.entryFnName;
        
        const {
          promise: completionPromise,
          resolve: resolveCompletionPromise,
          reject: rejectCompletionPromise,
        } = promiseWithResolvers();
        this.#completionPromise = completionPromise;
        
        this.#onResolveHandlers.push((results) => {
          if (this.#errored !== null) {
            rejectCompletionPromise(this.#errored);
            return;
          } else if (this.#rejected) {
            rejectCompletionPromise(results);
            return;
          }
          resolveCompletionPromise(results);
        });
        
        const {
          promise: exitPromise,
          resolve: resolveExitPromise,
          reject: rejectExitPromise,
        } = promiseWithResolvers();
        this.#exitPromise = exitPromise;
        
        this.#onExitHandlers.push(() => {
          resolveExitPromise();
        });
        
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
      entryFnName() { return this.#entryFnName; }
      
      completionPromise() { return this.#completionPromise; }
      exitPromise() { return this.#exitPromise; }
      
      isAsync() { return this.#isAsync; }
      isSync() { return !this.isAsync(); }
      
      getErrHandling() { return this.#errHandling; }
      
      hasCallback() { return this.#callbackFn !== null; }
      
      getReturnMemoryIdx() { return this.#memoryIdx; }
      setReturnMemoryIdx(idx) {
        if (idx === null) { return; }
        this.#memoryIdx = idx;
      }
      
      getReturnMemory() { return this.#memory; }
      setReturnMemory(m) {
        if (m === null) { return; }
        this.#memory = m;
      }
      
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
      
      async runCallbackFn(...args) {
        if (!this.#callbackFn) { throw new Error('on callback function has been set for task'); }
        return await this.#callbackFn.apply(null, args);
      }
      
      getCalleeParams() {
        if (!this.#getCalleeParamsFn) { throw new Error('missing/invalid getCalleeParamsFn'); }
        return this.#getCalleeParamsFn();
      }
      
      mayBlock() { return this.isAsync() || this.isResolvedState() }
      
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
      
      enterSync() {
        if (this.needsExclusiveLock()) {
          const cstate = getOrCreateAsyncState(this.#componentIdx);
          cstate.exclusiveLock();
        }
        return true;
      }
      
      async enter(opts) {
        _debugLog('[AsyncTask#enter()] args', {
          taskID: this.#id,
          componentIdx: this.#componentIdx,
          subtaskID: this.getParentSubtask()?.id(),
        });
        
        if (this.#entered) {
          throw new Error(`task with ID [${this.#id}] should not be entered twice`);
        }
        
        const cstate = getOrCreateAsyncState(this.#componentIdx);
        
        // If a task is either synchronous or host-provided (e.g. a host import, whether sync or async)
        // then we can avoid component-relevant tracking and immediately enter
        if (this.isSync() || opts?.isHost) {
          this.#entered = true;
          
          // TODO(breaking): remove once manually-spccifying async fns is removed
          // It is currently possible for an actually sync export to be specified
          // as async via JSPI
          if (this.#isManualAsync) {
            if (this.needsExclusiveLock()) { cstate.exclusiveLock(); }
          }
          
          return this.#entered;
        }
        
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
        
        this.#entered = true;
        return this.#entered;
      }
      
      isRunningState() { return this.#state !== AsyncTask.State.RESOLVED; }
      isResolvedState() { return this.#state === AsyncTask.State.RESOLVED; }
      isResolved() { return this.#state === AsyncTask.State.RESOLVED; }
      
      async waitUntil(opts) {
        const { readyFn, waitableSetRep, cancellable } = opts;
        _debugLog('[AsyncTask#waitUntil()] args', { taskID: this.#id, waitableSetRep, cancellable });
        
        const state = getOrCreateAsyncState(this.#componentIdx);
        const wset = state.handles.get(waitableSetRep);
        
        let event;
        
        wset.incrementNumWaiting();
        
        const keepGoing = await this.suspendUntil({
          readyFn: () => {
            const hasPendingEvent = wset.hasPendingEvent();
            const ready = readyFn();
            return ready && hasPendingEvent;
          },
          cancellable,
        });
        
        if (keepGoing) {
          event = wset.getPendingEvent();
        } else {
          event = {
            code: ASYNC_EVENT_CODE.TASK_CANCELLED,
            payload0: 0,
            payload1: 0,
          };
        }
        
        wset.decrementNumWaiting();
        
        return event;
      }
      
      async yieldUntil(opts) {
        const { readyFn, cancellable } = opts;
        _debugLog('[AsyncTask#yieldUntil()] args', { taskID: this.#id, cancellable });
        
        const keepGoing = await this.suspendUntil({ readyFn, cancellable });
        if (keepGoing) {
          return {
            code: ASYNC_EVENT_CODE.NONE,
            payload0: 0,
            payload1: 0,
          };
        }
        
        return {
          code: ASYNC_EVENT_CODE.TASK_CANCELLED,
          payload0: 0,
          payload1: 0,
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
        if (ready && ASYNC_DETERMINISM === 'random') {
          // const coinFlip = _coinFlip();
          // if (coinFlip) { return true }
          return true;
        }
        
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
      const keepGoing = await cstate.suspendTask({ task: this, readyFn });
      return keepGoing;
    }
    
    deliverPendingCancel(opts) {
      const { cancellable } = opts;
      _debugLog('[AsyncTask#deliverPendingCancel()] args', { cancellable });
      
      if (cancellable && this.#state === AsyncTask.State.PENDING_CANCEL) {
        this.#state = AsyncTask.State.CANCEL_DELIVERED;
        return true;
      }
      
      return false;
    }
    
    isCancelled() { return this.cancelled }
    
    cancel(args) {
      _debugLog('[AsyncTask#cancel()] args', { });
      if (this.taskState() !== AsyncTask.State.CANCEL_DELIVERED) {
        throw new Error(`(component [${this.#componentIdx}]) task [${this.#id}] invalid task state [${this.taskState()}] for cancellation`);
      }
      if (this.borrowedHandles.length > 0) { throw new Error('task still has borrow handles'); }
      this.cancelled = true;
      this.onResolve(args?.error ?? new Error('task cancelled'));
      this.#state = AsyncTask.State.RESOLVED;
    }
    
    onResolve(taskValue) {
      const handlers = this.#onResolveHandlers;
      this.#onResolveHandlers = [];
      for (const f of handlers) {
        try {
          // TODO(fix): resolve handlers getting called a ton?
          f(taskValue);
        } catch (err) {
          _debugLog("[AsyncTask#onResolve] error during task resolve handler", err);
          throw err;
        }
      }
      
      if (this.#parentSubtask) {
        const meta = this.#parentSubtask.getCallMetadata();
        // Run the rturn fn if it has not already been called -- this *should* have happened in
        // `task.return`, but some paths do not go through task.return (e.g. async lower of sync fn
        // which goes through prepare + async-start-call)
        if (meta.returnFn && !meta.returnFnCalled) {
          _debugLog('[AsyncTask#onResolve()] running returnFn', {
            componentIdx: this.#componentIdx,
            taskID: this.#id,
            subtaskID: this.#parentSubtask.id(),
          });
          const memory = meta.getMemoryFn();
          meta.returnFn.apply(null, [taskValue, meta.resultPtr]);
          meta.returnFnCalled = true;
        }
      }
      
      if (this.#postReturnFn) {
        _debugLog('[AsyncTask#onResolve()] running post return ', {
          componentIdx: this.#componentIdx,
          taskID: this.#id,
        });
        try {
          this.#postReturnFn(taskValue);
        } catch (err) {
          _debugLog("[AsyncTask#onResolve] error during task resolve handler", err);
          throw err;
        }
      }
      
      if (this.#parentSubtask) {
        this.#parentSubtask.onResolve(taskValue);
      }
    }
    
    registerOnResolveHandler(f) {
      this.#onResolveHandlers.push(f);
    }
    
    isRejected() { return this.#rejected; }
    
    setErrored(err) {
      this.#errored = err;
    }
    
    reject(taskErr) {
      _debugLog('[AsyncTask#reject()] args', {
        componentIdx: this.#componentIdx,
        taskID: this.#id,
        parentSubtask: this.#parentSubtask,
        parentSubtaskID: this.#parentSubtask?.id(),
        entryFnName: this.entryFnName(),
        callbackFnName: this.#callbackFnName,
        errMsg: taskErr.message,
      });
      
      if (this.isResolvedState() || this.#rejected) { return; }
      
      for (const subtask of this.#subtasks) {
        subtask.reject(taskErr);
      }
      
      this.#rejected = true;
      this.cancelRequested = true;
      this.#state = AsyncTask.State.PENDING_CANCEL;
      const cancelled = this.deliverPendingCancel({ cancellable: true });
      
      // TODO: do cleanup here to reset the machinery so we can run again?
      
      
      this.cancel({ error: taskErr });
    }
    
    resolve(results) {
      _debugLog('[AsyncTask#resolve()] args', {
        componentIdx: this.#componentIdx,
        taskID: this.#id,
        entryFnName: this.entryFnName(),
        callbackFnName: this.#callbackFnName,
      });
      
      if (this.#state === AsyncTask.State.RESOLVED) {
        throw new Error(`(component [${this.#componentIdx}]) task [${this.#id}]  is already resolved (did you forget to wait for an import?)`);
      }
      
      if (this.borrowedHandles.length > 0) {
        throw new Error('task still has borrow handles');
      }
      
      this.#state = AsyncTask.State.RESOLVED;
      
      switch (results.length) {
        case 0:
        this.onResolve(undefined);
        break;
        case 1:
        this.onResolve(results[0]);
        break;
        default:
        _debugLog('[AsyncTask#resolve()] unexpected number of results', {
          componentIdx: this.#componentIdx,
          results,
          taskID: this.#id,
          subtaskID: this.#parentSubtask?.id(),
          entryFnName: this.#entryFnName,
          callbackFnName: this.#callbackFnName,
        });
        throw new Error('unexpected number of results');
      }
    }
    
    exit() {
      _debugLog('[AsyncTask#exit()]', {
        componentIdx: this.#componentIdx,
        taskID: this.#id,
      });
      
      if (this.#exited)  { throw new Error("task has already exited"); }
      
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
      
      // Exempt the host from exclusive lock check
      if (this.#componentIdx !== -1 && this.needsExclusiveLock() && !state.isExclusivelyLocked()) {
        throw new Error(`task [${this.#id}] exit: component [${this.#componentIdx}] should have been exclusively locked`);
      }
      
      state.exclusiveRelease();
      
      for (const f of this.#onExitHandlers) {
        try {
          f();
        } catch (err) {
          console.error("error during task exit handler", err);
          throw err;
        }
      }
      
      this.#exited = true;
      clearCurrentTask(this.#componentIdx, this.id());
    }
    
    needsExclusiveLock() {
      return !this.#isAsync || this.hasCallback();
    }
    
    createSubtask(args) {
      _debugLog('[AsyncTask#createSubtask()] args', args);
      const { componentIdx, childTask, callMetadata, fnName, isAsync, isManualAsync } = args;
      
      const cstate = getOrCreateAsyncState(this.#componentIdx);
      if (!cstate) {
        throw new Error(`invalid/missing async state for component idx [${componentIdx}]`);
      }
      
      const waitable = new Waitable({
        componentIdx: this.#componentIdx,
        target: `subtask (internal ID [${this.#id}])`,
      });
      
      const newSubtask = new AsyncSubtask({
        componentIdx,
        childTask,
        parentTask: this,
        callMetadata,
        isAsync,
        isManualAsync,
        fnName,
        waitable,
      });
      this.#subtasks.push(newSubtask);
      newSubtask.setTarget(`subtask (internal ID [${newSubtask.id()}], waitable [${waitable.idx()}], component [${componentIdx}])`);
      waitable.setIdx(cstate.handles.insert(newSubtask));
      waitable.setTarget(`waitable for subtask (waitable id [${waitable.idx()}], subtask internal ID [${newSubtask.id()}])`);
      
      return newSubtask;
    }
    
    getLatestSubtask() {
      return this.#subtasks.at(-1);
    }
    
    getSubtaskByWaitableRep(rep) {
      if (rep === undefined) { throw new TypeError('missing rep'); }
      return this.#subtasks.find(s => s.waitableRep() === rep);
    }
    
    currentSubtask() {
      _debugLog('[AsyncTask#currentSubtask()]');
      if (this.#subtasks.length === 0) { return undefined; }
      return this.#subtasks.at(-1);
    }
    
    removeSubtask(subtask) {
      if (this.#subtasks.length === 0) { throw new Error('cannot end current subtask: no current subtask'); }
      this.#subtasks = this.#subtasks.filter(t => t !== subtask);
      return subtask;
    }
  }
  
  function _lowerImportBackwardsCompat(args) {
    const params = [...arguments].slice(1);
    _debugLog('[_lowerImportBackwardsCompat()] args', { args, params });
    const {
      functionIdx,
      componentIdx,
      isAsync,
      isManualAsync,
      paramLiftFns,
      resultLowerFns,
      funcTypeIsAsync,
      metadata,
      memoryIdx,
      getMemoryFn,
      getReallocFn,
      importFn,
      stringEncoding,
    } = args;
    
    let meta = _getGlobalCurrentTaskMeta(componentIdx);
    let createdTask;
    
    // Some components depend on initialization logic (i.e. `_initialize` or some such
    // core wasm export) that is embedded in the component, but is not executed or wizer'd
    // away before the transpiled component is attempted to be used.
    //
    // These components execut their initialization logic *when they are imported* in the
    // transpiled context -- so we may get a call to an export that is lowered without going
    // through `CallWasm` or `CallInterface`.
    //
    if (!meta) {
      if (funcTypeIsAsync || (isAsync && !isManualAsync)) {
        throw new Error('p3 async wasm exports cannot use backwards compat auto-task init');
      }
      
      const [newTask, newTaskID] = createNewCurrentTask({
        componentIdx,
        isAsync,
        isManualAsync,
        callingWasmExport: false,
      });
      createdTask = newTask;
      
      // Since we're managing the task creation ourselves we must clear ourselves
      createdTask.registerOnResolveHandler(() => {
        _clearCurrentTask({
          taskID: task.id(),
          componentIdx: task.componentIdx(),
        });
      });
      
      _setGlobalCurrentTaskMeta({
        componentIdx,
        taskID: newTaskID,
      });
      
      meta = _getGlobalCurrentTaskMeta(componentIdx);
    }
    
    const { taskID } = meta;
    
    const taskMeta = getCurrentTask(componentIdx, taskID);
    if (!taskMeta) {
      throw new Error('invalid/missing async task meta');
    }
    
    const task = taskMeta.task;
    if (!task) { throw new Error('invalid/missing async task'); }
    
    const cstate = getOrCreateAsyncState(componentIdx);
    
    // TODO: re-enable this check -- postReturn can call imports though,
    // and that breaks things.
    //
    // if (!cstate.mayLeave) {
      //     throw new Error(`cannot leave instance [${componentIdx}]`);
      // }
      
      if (!task.mayBlock() && funcTypeIsAsync && !isAsync) {
        throw new Error("non async exports cannot synchronously call async functions");
      }
      
      // If there is an existing task, this should be part of a subtask
      const memory = getMemoryFn();
      const subtask = task.createSubtask({
        componentIdx,
        parentTask: task,
        fnName: importFn.fnName,
        isAsync,
        isManualAsync,
        callMetadata: {
          memoryIdx,
          memory,
          realloc: getReallocFn(),
          resultPtr: params[0],
          lowers: resultLowerFns,
          stringEncoding,
        }
      });
      task.setReturnMemoryIdx(memoryIdx);
      task.setReturnMemory(getMemoryFn());
      
      subtask.onStart();
      
      // If dealing with a sync lowered sync function, we can directly return results
      //
      // TODO(breaking): remove once we get rid of manual async import specification,
      // as func types cannot be detected in that case only (and we don't need that w/ p3)
      if (!isManualAsync && !isAsync && !funcTypeIsAsync) {
        if (createdTask) { createdTask.enterSync(); }
        
        const res = importFn(...params);
        
        // TODO(breaking): remove once we get rid of manual async import specification,
        // as func types cannot be detected in that case only (and we don't need that w/ p3)
        if (!funcTypeIsAsync && !subtask.isReturned()) {
          throw new Error('post-execution subtasks must either be async or returned');
        }
        
        const syncRes = subtask.getResult();
        if (createdTask) { createdTask.resolve([syncRes]); }
        
        return syncRes;
      }
      
      // Sync-lowered async functions requires async behavior because the callee *can* block,
      // but this call must *act* synchronously and return immediately with the result
      // (i.e. not returning until the work is done)
      //
      // TODO(breaking): remove checking for manual async specification here, once we can go p3-only
      //
      if (!isManualAsync && !isAsync && funcTypeIsAsync) {
        const { promise, resolve } = new Promise();
        queueMicrotask(async () => {
          if (!subtask.isResolvedState()) {
            await task.suspendUntil({ readyFn: () => task.isResolvedState() });
          }
          resolve(subtask.getResult());
        });
        return promise;
      }
      
      // NOTE: at this point we know that we are working with an async lowered import
      
      const subtaskState = subtask.getStateNumber();
      if (subtaskState < 0 || subtaskState > 2**5) {
        throw new Error('invalid subtask state, out of valid range');
      }
      
      subtask.setOnProgressFn(() => {
        subtask.setPendingEvent(() => {
          if (subtask.isResolved()) { subtask.deliverResolve(); }
          const event = {
            code: ASYNC_EVENT_CODE.SUBTASK,
            payload0: subtask.waitableRep(),
            payload1: subtask.getStateNumber(),
          }
          return event;
        });
      });
      
      // This is a hack to maintain backwards compatibility with
      // manually-specified async imports, used in wasm exports that are
      // not actually async (but are specified as so).
      //
      // This is not normal p3 sync behavior but instead anticipating that
      // the caller that is doing manual async will be waiting for a promise that
      // resolves to the *actual* result.
      //
      // TODO(breaking): remove once manually specified async is removed
      //
      // There are a few cases:
      // 1. sync function with async types (e.g. `f: func() -> stream<u32>`)
      // 2. async function with async types (e.g. `f: async func() -> stream<u32>`)
      // 3. async function with sync types (e.g. `f: async func() -> list<u32>`)
      // 4. sync function with non-async types (e.g. `f: func() -> list<u32>`)
      //
      // This hack *only* applies to 4 -- the case where an async JS host function
      // is supplied to a Wasm export which does *not* need to do any async abi
      // lifting/lowering (async ABI did not exist when JSPI integratiton was
      // initially merged to enable asynchronously returning values from the host)
      //
      const requiresManualAsyncResult = !isAsync && !funcTypeIsAsync && isManualAsync;
      let manualAsyncResult;
      if (requiresManualAsyncResult) {
        manualAsyncResult = promiseWithResolvers();
      }
      
      queueMicrotask(async () => {
        try {
          _debugLog('[_lowerImportBackwardsCompat()] calling lowered import', { importFn, params });
          if (createdTask) { await createdTask.enter(); }
          
          const asyncRes = await importFn(...params);
          if (requiresManualAsyncResult) {
            manualAsyncResult.resolve(subtask.getResult());
          }
          
          if (createdTask) { createdTask.resolve([asyncRes]); }
          
          
        } catch (err) {
          _debugLog("[_lowerImportBackwardsCompat()] import fn error:", err);
          if (requiresManualAsyncResult) {
            manualAsyncResult.reject(err);
          }
          throw err;
        }
      });
      
      if (requiresManualAsyncResult) { return manualAsyncResult.promise; }
      
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
      
      if (ctx.storageLen !== undefined && ctx.storageLen < 1) {
        throw new Error(`insufficient storage ([${ctx.storageLen}] bytes) for lift (u8 requires 1 byte)`);
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
      
      if (ctx.storageLen !== undefined && ctx.storageLen < 2) {
        throw new Error(`insufficient storage ([${ctx.storageLen}] bytes) for lift (u16 requires 2 bytes)`);
      }
      
      val = new DataView(ctx.memory.buffer).getUint16(ctx.storagePtr, true);
      
      ctx.storagePtr += 2;
      if (ctx.storageLen !== undefined) { ctx.storageLen -= 2; }
      
      const rem = ctx.storagePtr % 2;
      if (rem !== 0) { ctx.storagePtr += (2 - rem); }
      
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
      
      if (ctx.storageLen !== undefined && ctx.storageLen < 4) {
        throw new Error(`insufficient storage ([${ctx.storageLen}] bytes) for lift (u32 requires 4 bytes)`);
      }
      val = new DataView(ctx.memory.buffer).getUint32(ctx.storagePtr, true);
      ctx.storagePtr += 4;
      if (ctx.storageLen !== undefined) { ctx.storageLen -= 4; }
      
      return [val, ctx];
    }
    
    
    function _liftFlatStringAny(ctx) {
      switch (ctx.stringEncoding) {
        case 'utf8':
        return _liftFlatStringUTF8(ctx);
        case 'utf16':
        return _liftFlatStringUTF16(ctx);
        default:
        throw new Error(`missing/unrecognized/unsupported string encoding [${ctx.stringEncoding}]`);
      }
    }
    
    function _liftFlatStringUTF8(ctx) {
      _debugLog('[_liftFlatStringUTF8()] args', { ctx });
      let val;
      
      if (ctx.useDirectParams) {
        if (ctx.params.length < 2) { throw new Error('expected at least two u32 arguments'); }
        const offset = ctx.params[0];
        if (!Number.isSafeInteger(offset)) {  throw new Error('invalid offset'); }
        const len = ctx.params[1];
        if (!Number.isSafeInteger(len)) {  throw new Error('invalid len'); }
        val = TEXT_DECODER_UTF8.decode(new DataView(ctx.memory.buffer, offset, len));
        ctx.params = ctx.params.slice(2);
        return [val, ctx];
      }
      
      const rem = ctx.storagePtr % 4;
      if (rem !== 0) { ctx.storagePtr += (4 - rem); }
      
      const dv = new DataView(ctx.memory.buffer);
      const start = dv.getUint32(ctx.storagePtr, true);
      const codeUnits = dv.getUint32(ctx.storagePtr + 4, true);
      
      val = TEXT_DECODER_UTF8.decode(new Uint8Array(ctx.memory.buffer, start, codeUnits));
      
      ctx.storagePtr += 8;
      if (ctx.storageLen !== undefined) { ctx.storagelen -= 8; }
      
      return [val, ctx];
    }
    
    function _liftFlatStringUTF16(ctx) {
      _debugLog('[_liftFlatStringUTF16()] args', { ctx });
      let val;
      
      if (ctx.useDirectParams) {
        if (ctx.params.length < 2) { throw new Error('expected at least two u32 arguments'); }
        const offset = ctx.params[0];
        if (!Number.isSafeInteger(offset)) {  throw new Error('invalid offset'); }
        const len = ctx.params[1];
        if (!Number.isSafeInteger(len)) {  throw new Error('invalid len'); }
        val = utf16Decoder.decode(new DataView(ctx.memory.buffer, offset, len));
        ctx.params = ctx.params.slice(2);
        return [val, ctx];
      }
      
      const data = new DataView(ctx.memory.buffer)
      const start = data.getUint32(ctx.storagePtr, vals[0], true);
      const codeUnits = data.getUint32(ctx.storagePtr, vals[0] + 4, true);
      val = utf16Decoder.decode(new Uint16Array(ctx.memory.buffer, start, codeUnits));
      ctx.storagePtr = ctx.storagePtr + 2 * codeUnits;
      if (ctx.storageLen !== undefined) { ctx.storageLen = ctx.storageLen - 2 * codeUnits }
      
      return [val, ctx];
    }
    
    function _liftFlatVariant(casesAndLiftFns) {
      return function _liftFlatVariantInner(ctx) {
        _debugLog('[_liftFlatVariant()] args', { ctx });
        
        const origUseParams = ctx.useDirectParams;
        
        let caseIdx;
        let liftRes;
        const originalPtr = ctx.storagePtr;
        const numCases =  casesAndLiftFns.length;
        if (casesAndLiftFns.length < 256) {
          liftRes = _liftFlatU8(ctx);
        } else if (numCases >= 256 && numCases < 65536) {
          liftRes = _liftFlatU16(ctx);
        } else if (numCases >= 65536 && numCases < 4_294_967_296) {
          liftRes = _liftFlatU32(ctx);
        } else {
          throw new Error(`unsupported number of variant cases [${numCases}]`);
        }
        caseIdx = liftRes[0];
        ctx = liftRes[1];
        
        const [ tag, liftFn, size32, align32, payloadOffset32 ] = casesAndLiftFns[caseIdx];
        if (payloadOffset32 === undefined) { throw new Error('unexpectedly missing payload offset'); }
        
        if (originalPtr !== undefined) {
          ctx.storagePtr = originalPtr + payloadOffset32;
        }
        
        let val;
        if (liftFn === null) {
          val = { tag };
          // NOTE: here we need to move past the entire object in memory
          // despite moving to the payload which we now know is missing/unnecessary
          ctx.storagePtr = originalPtr + size32;
        } else {
          const [newVal, newCtx] = liftFn(ctx);
          val = { tag, val: newVal };
          ctx = newCtx;
          
          // NOTE: Padding can be left over after doing the lift if it was less than
          // space left for the payload normally.
          if (ctx.storagePtr < originalPtr + size32) {
            ctx.storagePtr = originalPtr + size32;
          }
        }
        
        const rem = ctx.storagePtr % align32;
        if (rem !== 0) { ctx.storagePtr += align32 - rem; }
        
        return [val, ctx];
      }
    }
    
    function _liftFlatOption(casesAndLiftFns) {
      return function _liftFlatOptionInner(ctx) {
        _debugLog('[_liftFlatOption()] args', { ctx });
        return _liftFlatVariant(casesAndLiftFns)(ctx);
      }
    }
    
    function _lowerFlatBool(ctx) {
      _debugLog('[_lowerFlatBool()] args', { ctx });
      
      if (!ctx.memory) { throw new Error("missing memory for lower"); }
      if (ctx.vals.length !== 1) {
        throw new Error(`unexpected number [${ctx.vals.length}] of vals (expected 1)`);
      }
      
      _requireValidNumericPrimitive.bind('bool', ctx.vals[0]);
      new DataView(ctx.memory.buffer).setUint32(ctx.storagePtr, ctx.vals[0], true);
      
      ctx.storagePtr += 1;
    }
    
    function _lowerFlatU8(ctx) {
      _debugLog('[_lowerFlatU8()] args', ctx);
      
      if (ctx.vals.length !== 1) {
        throw new Error(`unexpected number [${ctx.vals.length}] of vals (expected 1)`);
      }
      
      _requireValidNumericPrimitive.bind('u8', ctx.vals[0]);
      
      if (!ctx.memory) { throw new Error("missing memory for lower"); }
      new DataView(ctx.memory.buffer).setUint32(ctx.storagePtr, ctx.vals[0], true);
      
      ctx.storagePtr += 1;
    }
    
    function _lowerFlatU16(ctx) {
      _debugLog('[_lowerFlatU16()] args', { ctx });
      
      if (!ctx.memory) { throw new Error("missing memory for lower"); }
      if (ctx.vals.length !== 1) {
        throw new Error(`unexpected number [${ctx.vals.length}] of vals (expected 1)`);
      }
      
      const rem = ctx.storagePtr % 2;
      if (rem !== 0) { ctx.storagePtr += (2 - rem); }
      
      _requireValidNumericPrimitive.bind('u16', ctx.vals[0]);
      new DataView(ctx.memory.buffer).setUint16(ctx.storagePtr, ctx.vals[0], true);
      
      ctx.storagePtr += 2;
    }
    
    function _lowerFlatU32(ctx) {
      _debugLog('[_lowerFlatU32()] args', { ctx });
      
      if (ctx.vals.length !== 1) {
        throw new Error(`expected single value to lower, got [${ctx.vals.length}]`);
      }
      
      const rem = ctx.storagePtr % 4;
      if (rem !== 0) { ctx.storagePtr += (4 - rem); }
      
      _requireValidNumericPrimitive.bind('u32', ctx.vals[0]);
      new DataView(ctx.memory.buffer).setUint32(ctx.storagePtr, ctx.vals[0], true);
      
      ctx.storagePtr += 4;
    }
    
    function _lowerFlatStringAny(ctx) {
      switch (ctx.stringEncoding) {
        case 'utf8':
        return _lowerFlatStringUTF8(ctx);
        case 'utf16':
        return _lowerFlatStringUTF16(ctx);
        default:
        throw new Error(`missing/unrecognized/unsupported string encoding [${ctx.stringEncoding}]`);
      }
    }
    
    function _lowerFlatStringUTF8(ctx) {
      _debugLog('[_lowerFlatStringUTF8()] args', ctx);
      if (!ctx.realloc) { throw new Error('missing realloc during flat string lower'); }
      
      const s = ctx.vals[0];
      const { ptr, codepoints } = _utf8AllocateAndEncode(ctx.vals[0], ctx.realloc, ctx.memory);
      
      const view = new DataView(ctx.memory.buffer);
      view.setUint32(ctx.storagePtr, ptr, true);
      view.setUint32(ctx.storagePtr + 4, codepoints, true);
      
      ctx.storagePtr += 8;
    }
    
    function _lowerFlatStringUTF16(ctx) {
      _debugLog('[_lowerFlatStringUTF16()] args', { ctx });
      if (!ctx.realloc) { throw new Error('missing realloc during flat string lower'); }
      
      const s = ctx.vals[0];
      const { ptr, len, codepoints } = _utf16AllocateAndEncode(ctx.vals[0], ctx.realloc, ctx.memory);
      
      const view = new DataView(ctx.memory.buffer);
      view.setUint32(ctx.storagePtr, ptr, true);
      view.setUint32(ctx.storagePtr + 4, codepoints, true);
      
      const bytes = new Uint16Array(ctx.memory.buffer, start, codeUnits);
      if (ctx.memory.buffer.byteLength < start + bytes.byteLength) {
        throw new Error('memory out of bounds');
      }
      if (ctx.storageLen !== undefined && ctx.storageLen !== bytes.byteLength) {
        throw new Error(`storage length [${ctx.storageLen}] != [${bytes.byteLength}])`);
      }
      new Uint16Array(ctx.memory.buffer, ctx.storagePtr).set(bytes);
      
      ctx.storagePtr += len;
    }
    
    function _lowerFlatRecord(fieldMetas) {
      return function _lowerFlatRecordInner(ctx) {
        _debugLog('[_lowerFlatRecord()] args', { ctx });
        
        const r = ctx.vals[0];
        for (const [tag, lowerFn, size32, align32 ] of fieldMetas) {
          ctx.vals = [r[tag]];
          lowerFn(ctx);
        }
      }
    }
    
    function _lowerFlatVariant(lowerMetas) {
      let caseLookup = {};
      for (const [idx, meta] of lowerMetas.entries()) {
        let tag = meta[0];
        caseLookup[tag] = { discriminant: idx, meta };
      }
      
      return function _lowerFlatVariantInner(ctx) {
        _debugLog('[_lowerFlatVariant()] args', { ctx });
        
        const { tag, val } = ctx.vals[0];
        const variantCase = caseLookup[tag];
        if (!variantCase) {
          throw new Error(`missing tag [${tag}] (valid tags: ${Object.keys(caseLookup)})`);
        }
        
        const [ _tag, lowerFn, size32, align32, payloadOffset32 ] = variantCase.meta;
        
        const originalPtr = ctx.storagePtr;
        ctx.vals = [variantCase.discriminant];
        let discLowerRes;
        if (lowerMetas.length < 256) {
          discLowerRes = _lowerFlatU8(ctx);
        } else if (lowerMetas.length >= 256 && lowerMetas.length < 65536) {
          discLowerRes = _lowerFlatU16(ctx);
        } else if (lowerMetas.length >= 65536 && lowerMetas.length < 4_294_967_296) {
          discLowerRes = _lowerFlatU32(ctx);
        } else {
          throw new Error(`unsupported number of cases [${lowerMetas.length}]`);
        }
        
        const payloadOffsetPtr = originalPtr + payloadOffset32;
        ctx.storagePtr = payloadOffsetPtr;
        ctx.vals = [val];
        if (lowerFn) { lowerFn(ctx); }
        
        let bytesWritten = ctx.storagePtr - payloadOffsetPtr;
        
        const rem = ctx.storagePtr % align32;
        if (rem !== 0) {
          const pad = align32 - rem;
          ctx.storagePtr += pad;
          bytesWritten += pad;
        }
        
        ctx.storagePtr += bytesWritten;
      }
    }
    
    function _lowerFlatList(meta) {
      const {
        elemLowerFn,
        knownLen,
        size32,
        align32,
        elemSize32,
        elemAlign32,
      } = meta;
      
      if (!elemLowerFn) { throw new TypeError("missing/invalid element lower fn for list"); }
      
      return function _lowerFlatListInner(ctx) {
        _debugLog('[_lowerFlatList()] args', { ctx });
        
        if (ctx.useDirectParams) {
          if (ctx.params.length < 2) { throw new Error('insufficient params left to lower list'); }
          const storagePtr = ctx.params[0];
          const elemCount = ctx.params[1];
          ctx.params = ctx.params.slice(2);
          
          const list = ctx.vals[0];
          if (!list) { throw new Error("missing direct param value"); }
          
          const lowerCtx = {
            storagePtr,
            memory: ctx.memory,
            stringEncoding: ctx.stringEncoding,
          };
          for (let idx = 0; idx < list.length; idx++) {
            lowerCtx.vals = list.slice(idx, idx+1);
            elemLowerFn(lowerCtx);
          }
          
          const bytesLowered = lowerCtx.storagePtr - ctx.storagePtr;
          ctx.storagePtr = lowerCtx.storagePtr;
          
          // TODO: implement parma-only known-length processing
          
          ctx.storagePtr += bytesLowered;
          return;
        }
        
        // TODO(fix): is it possible to get a vals that are a addr and length here from
        // a component lower?
        
        const elems = ctx.vals[0];
        if (knownLen === undefined) {
          // unknown length
          if (!ctx.realloc) { throw new Error('missing realloc during flat string lower'); }
          const dataPtr = ctx.realloc(0, 0, elemAlign32, elemSize32 * elems.length);
          
          ctx.vals[0] = dataPtr;
          _lowerFlatU32(ctx);
          
          ctx.vals[0] = elems.length;
          _lowerFlatU32(ctx);
          
          const origPtr = ctx.storagePtr;
          ctx.storagePtr = dataPtr;
          
          ctx.storagePtr = dataPtr;
          for (const elem of elems) {
            ctx.vals = [elem];
            elemLowerFn(ctx);
          }
          
          ctx.storagePtr = origPtr;
          
        } else {
          // known length
          
          if (elems.length !== knownLen) {
            throw new TypeError(`invalid list input of length [${elems.length}], must be length [${knownLen}]`);
          }
          
          for (const elem of elems) {
            ctx.vals = [elem];
            elemLowerFn(ctx);
          }
        }
        
        // TODO(fix): special case for u8/u16/etc, we can do a direct copy
        
        const totalSizeBytes = elems.length * size32;
        if (ctx.storageLen !== undefined && totalSizeBytes > ctx.storageLen) {
          throw new Error('not enough storage remaining for list flat lower');
        }
      }
    }
    
    function _lowerFlatResult(lowerMetas) {
      return function _lowerFlatResultInner(ctx) {
        _debugLog('[_lowerFlatResult()] args', { lowerMetas });
        
        const v = ctx.vals[0];
        const isNotResultObject = typeof v !== 'object'
        || Object.keys(v).length !== 2
        || !('tag' in v)
        || !('ok' === v.tag || 'err' === v.tag)
        || !('val' in v);
        if (isNotResultObject) {
          ctx.vals[0] = { tag: 'ok', val: v };
        }
        
        _lowerFlatVariant(lowerMetas)(ctx);
      };
    }
    
    const STREAMS = new RepTable({ target: 'global stream map' });
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
      #errored = null;
      
      #backpressure = 0;
      #backpressureWaiters = 0n;
      
      #handlerMap = new Map();
      #nextHandlerID = 0n;
      
      #tickLoop = null;
      #tickLoopInterval = null;
      
      #onExclusiveReleaseHandlers = [];
      
      mayLeave = true;
      
      handles;
      subtasks;
      
      constructor(args) {
        this.#componentIdx = args.componentIdx;
        this.handles = new RepTable({ target: `component [${this.#componentIdx}] handles (waitable objects)` });
        this.subtasks = new RepTable({ target: `component [${this.#componentIdx}] subtasks` });
      };
      
      componentIdx() { return this.#componentIdx; }
      
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
      
      setBackpressure(v) {
        this.#backpressure = v;
        return this.#backpressure
      }
      getBackpressure() { return this.#backpressure; }
      
      incrementBackpressure() {
        const current = this.#backpressure;
        if (current < 0 || current > 2**16) {
          throw new Error(`invalid current backpressure value [${current}]`);
        }
        const newValue = this.getBackpressure() + 1;
        if (newValue >= 2**16) {
          throw new Error(`invalid new backpressure value [${newValue}], overflow`);
        }
        return this.setBackpressure(newValue);
      }
      
      decrementBackpressure() {
        const current = this.#backpressure;
        if (current < 0 || current > 2**16) {
          throw new Error(`invalid current backpressure value [${current}]`);
        }
        const newValue = Math.max(0, current - 1);
        if (newValue < 0) {
          throw new Error(`invalid new backpressure value [${newValue}], underflow`);
        }
        return this.setBackpressure(newValue);
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
      
      isExclusivelyLocked() { return this.#locked === true; }
      setLocked(locked) {
        this.#locked = locked;
      }
      
      // TODO(fix): we might want to check for pre-locked status here, we should be deterministically
      // going from locked -> unlocked and vice versa
      exclusiveLock() {
        _debugLog('[ComponentAsyncState#exclusiveLock()]', {
          locked: this.#locked,
          componentIdx: this.#componentIdx,
        });
        this.setLocked(true);
      }
      
      exclusiveRelease() {
        _debugLog('[ComponentAsyncState#exclusiveRelease()] args', {
          locked: this.#locked,
          componentIdx: this.#componentIdx,
        });
        this.setLocked(false);
        
        this.#onExclusiveReleaseHandlers = this.#onExclusiveReleaseHandlers.filter(v => !!v);
        for (const [idx, f] of this.#onExclusiveReleaseHandlers.entries()) {
          try {
            this.#onExclusiveReleaseHandlers[idx] = null;
            f();
          } catch (err) {
            _debugLog("error while executing handler for next exclusive release", err);
            throw err;
          }
        }
      }
      
      onNextExclusiveRelease(fn) {
        _debugLog('[ComponentAsyncState#()onNextExclusiveRelease] registering');
        this.#onExclusiveReleaseHandlers.push(fn);
      }
      
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
      
      // TODO(threads): readyFn is normally on the thread
      suspendTask(args) {
        const { task, readyFn } = args;
        const taskID = task.id();
        _debugLog('[ComponentAsyncState#suspendTask()]', {
          taskID,
          componentIdx: this.#componentIdx,
          taskEntryFnName: task.entryFnName(),
          subtask: task.getParentSubtask(),
        });
        
        if (this.#getSuspendedTaskMeta(taskID)) {
          throw new Error(`task [${taskID}] already suspended`);
        }
        
        const { promise, resolve, reject } = promiseWithResolvers();
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
        
        this.runTickLoop();
        
        return promise;
      }
      
      resumeTaskByID(taskID) {
        const meta = this.#removeSuspendedTaskMeta(taskID);
        if (!meta) { return; }
        if (meta.taskID !== taskID) { throw new Error('task ID does not match'); }
        meta.resume();
      }
      
      async runTickLoop() {
        if (this.#tickLoop !== null) { return; }
        this.#tickLoop = 1;
        setTimeout(async () => {
          let done = this.tick();
          while (!done) {
            await new Promise((resolve) => setTimeout(resolve, 30));
            done = this.tick();
          }
          this.#tickLoop = null;
        }, 10);
      }
      
      tick() {
        // _debugLog('[ComponentAsyncState#tick()]', { suspendedTaskIDs: this.#suspendedTaskIDs });
        
        const resumableTasks = this.#suspendedTaskIDs.filter(t => t !== null);
        for (const taskID of resumableTasks) {
          const meta = this.#suspendedTasksByTaskID.get(taskID);
          if (!meta || !meta.readyFn) {
            throw new Error(`missing/invalid task despite ID [${taskID}] being present`);
          }
          
          // If the task failed via any means, allow the task to resume because
          // it's been cancelled -- the callback should immediately exit as well
          if (meta.task.isRejected()) {
            _debugLog('[ComponentAsyncState#suspendTask()] detected task rejection, leaving early', { meta });
            this.resumeTaskByID(taskID);
            return;
          }
          
          const isReady = meta.readyFn();
          if (!isReady) { continue; }
          
          this.resumeTaskByID(taskID);
        }
        
        return this.#suspendedTaskIDs.filter(t => t !== null).length === 0;
      }
      
      addStreamEndToTable(args) {
        _debugLog('[ComponentAsyncState#addStreamEnd()] args', args);
        const { tableIdx, streamEnd } = args;
        if (typeof streamEnd === 'number') { throw new Error("INSERTING BAD STREAMEND"); }
        
        let { table, componentIdx } = STREAM_TABLES[tableIdx];
        if (componentIdx === undefined || !table) {
          throw new Error(`invalid global stream table state for table [${tableIdx}]`);
        }
        
        const handle = table.insert(streamEnd);
        streamEnd.setHandle(handle);
        streamEnd.setStreamTableIdx(tableIdx);
        
        const cstate = getOrCreateAsyncState(componentIdx);
        const waitableIdx = cstate.handles.insert(streamEnd);
        streamEnd.setWaitableIdx(waitableIdx);
        
        _debugLog('[ComponentAsyncState#addStreamEnd()] added stream end', {
          tableIdx,
          table,
          handle,
          streamEnd,
          destComponentIdx: componentIdx,
        });
        
        return { handle, waitableIdx };
      }
      
      createWaitable(args) {
        return new Waitable({ target: args?.target, });
      }
      
      createReadableStreamEnd(args) {
        _debugLog('[ComponentAsyncState#createStreamEnd()] args', args);
        const { tableIdx, elemMeta, hostInjectFn } = args;
        
        const { table: localStreamTable, componentIdx } = STREAM_TABLES[tableIdx];
        if (!localStreamTable) {
          throw new Error(`missing global stream table lookup for table [${tableIdx}] while creating stream`);
        }
        if (componentIdx !== this.#componentIdx) {
          throw new Error('component idx mismatch while creating stream');
        }
        
        const waitable = this.createWaitable();
        const streamEnd = new StreamReadableEnd({
          tableIdx,
          elemMeta,
          hostInjectFn,
          pendingBufferMeta: {},
          target: `stream read end (lowered, @init)`,
          waitable,
        });
        
        streamEnd.setWaitableIdx(this.handles.insert(streamEnd));
        streamEnd.setHandle(localStreamTable.insert(streamEnd));
        if (streamEnd.streamTableIdx() !== tableIdx) {
          throw new Error("unexpectedly mismatched stream table");
        }
        const streamEndWaitableIdx = streamEnd.waitableIdx();
        const streamEndHandle = streamEnd.handle();
        waitable.setTarget(`waitable for stream read end (lowered, waitable [${streamEndWaitableIdx}])`);
        streamEnd.setTarget(`stream read end (lowered, waitable [${streamEndWaitableIdx}])`);
        
        return {
          waitableIdx: streamEndWaitableIdx,
          handle: streamEndHandle,
          streamEnd,
        };
      }
      
      createStream(args) {
        _debugLog('[ComponentAsyncState#createStream()] args', args);
        const { tableIdx, elemMeta, hostInjectFn } = args;
        if (tableIdx === undefined) { throw new Error("missing table idx while adding stream"); }
        if (elemMeta === undefined) { throw new Error("missing element metadata while adding stream"); }
        
        const { table: localStreamTable, componentIdx } = STREAM_TABLES[tableIdx];
        if (!localStreamTable) {
          throw new Error(`missing global stream table lookup for table [${tableIdx}] while creating stream`);
        }
        if (componentIdx !== this.#componentIdx) {
          throw new Error('component idx mismatch while creating stream');
        }
        
        const readWaitable = this.createWaitable();
        const writeWaitable = this.createWaitable();
        
        const stream = new InternalStream({
          tableIdx,
          elemMeta,
          readWaitable,
          writeWaitable,
          hostInjectFn,
        });
        stream.setGlobalStreamMapRep(STREAMS.insert(stream));
        
        const writeEnd = stream.writeEnd();
        writeEnd.setWaitableIdx(this.handles.insert(writeEnd));
        writeEnd.setHandle(localStreamTable.insert(writeEnd));
        if (writeEnd.streamTableIdx() !== tableIdx) { throw new Error("unexpectedly mismatched stream table"); }
        
        const writeEndWaitableIdx = writeEnd.waitableIdx();
        const writeEndHandle = writeEnd.handle();
        writeWaitable.setTarget(`waitable for stream write end (waitable [${writeEndWaitableIdx}])`);
        writeEnd.setTarget(`stream write end (waitable [${writeEndWaitableIdx}])`);
        
        const readEnd = stream.readEnd();
        readEnd.setWaitableIdx(this.handles.insert(readEnd));
        readEnd.setHandle(localStreamTable.insert(readEnd));
        if (readEnd.streamTableIdx() !== tableIdx) { throw new Error("unexpectedly mismatched stream table"); }
        
        const readEndWaitableIdx = readEnd.waitableIdx();
        const readEndHandle = readEnd.handle();
        readWaitable.setTarget(`waitable for read end (waitable [${readEndWaitableIdx}])`);
        readEnd.setTarget(`stream read end (waitable [${readEndWaitableIdx}])`);
        
        return {
          writeEnd,
          writeEndWaitableIdx,
          writeEndHandle,
          readEndWaitableIdx,
          readEndHandle,
          readEnd,
        };
      }
      
      getStreamEnd(args) {
        _debugLog('[ComponentAsyncState#getStreamEnd()] args', args);
        const { tableIdx, streamEndHandle, streamEndWaitableIdx } = args;
        if (tableIdx === undefined) {
          throw new Error('missing table idx while getting stream end');
        }
        
        const { table, componentIdx } = STREAM_TABLES[tableIdx];
        const cstate = getOrCreateAsyncState(componentIdx);
        
        let streamEnd;
        if (streamEndWaitableIdx !== undefined) {
          streamEnd = cstate.handles.get(streamEndWaitableIdx);
        } else if (streamEndHandle !== undefined) {
          if (!table) { throw new Error(`missing/invalid table [${tableIdx}] while getting stream end`); }
          streamEnd = table.get(streamEndHandle);
        } else {
          throw new TypeError("must specify either waitable idx or handle to retrieve stream");
        }
        
        if (!streamEnd) {
          throw new Error(`missing stream end (tableIdx [${tableIdx}], handle [${streamEndHandle}], waitableIdx [${streamEndWaitableIdx}])`);
        }
        if (tableIdx && streamEnd.streamTableIdx() !== tableIdx) {
          throw new Error(`stream end table idx [${streamEnd.streamTableIdx()}] does not match [${tableIdx}]`);
        }
        
        return streamEnd;
      }
      
      deleteStreamEnd(args) {
        _debugLog('[ComponentAsyncState#deleteStreamEnd()] args', args);
        const { tableIdx, streamEndWaitableIdx } = args;
        if (tableIdx === undefined) { throw new Error("missing table idx while removing stream end"); }
        if (streamEndWaitableIdx === undefined) { throw new Error("missing stream idx while removing stream end"); }
        
        const { table, componentIdx } = STREAM_TABLES[tableIdx];
        const cstate = getOrCreateAsyncState(componentIdx);
        
        const streamEnd = cstate.handles.get(streamEndWaitableIdx);
        if (!streamEnd) {
          throw new Error(`missing stream end [${streamEndWaitableIdx}] in component handles while deleting stream`);
        }
        if (streamEnd.streamTableIdx() !== tableIdx) {
          throw new Error(`stream end table idx [${streamEnd.streamTableIdx()}] does not match [${tableIdx}]`);
        }
        
        let removed = cstate.handles.remove(streamEnd.waitableIdx());
        if (!removed) {
          throw new Error(`failed to remove stream end [${streamEndWaitableIdx}] waitable obj in component [${componentIdx}]`);
        }
        
        removed = table.remove(streamEnd.handle());
        if (!removed) {
          throw new Error(`failed to remove stream end with handle [${streamEnd.handle()}] from stream table [${tableIdx}] in component [${componentIdx}]`);
        }
        
        return streamEnd;
      }
      
      removeStreamEndFromTable(args) {
        _debugLog('[ComponentAsyncState#removeStreamEndFromTable()] args', args);
        
        const { tableIdx, streamWaitableIdx } = args;
        if (tableIdx === undefined) { throw new Error("missing table idx while removing stream end"); }
        if (streamWaitableIdx === undefined) {
          throw new Error("missing stream end waitable idx while removing stream end");
        }
        
        const { table, componentIdx } = STREAM_TABLES[tableIdx];
        if (!table) { throw new Error(`missing/invalid table [${tableIdx}] while removing stream end`); }
        
        const cstate = getOrCreateAsyncState(componentIdx);
        
        const streamEnd = cstate.handles.get(streamWaitableIdx);
        if (!streamEnd) {
          throw new Error(`missing stream end (handle [${streamWaitableIdx}], table [${tableIdx}])`);
        }
        const handle = streamEnd.handle();
        
        let removed = cstate.handles.remove(streamWaitableIdx);
        if (!removed) {
          throw new Error(`failed to remove streamEnd from handles (waitable idx [${streamWaitableIdx}]), component [${componentIdx}])`);
        }
        
        removed = table.remove(handle);
        if (!removed) {
          throw new Error(`failed to remove streamEnd from table (handle [${handle}]), table [${tableIdx}], component [${componentIdx}])`);
        }
        
        return streamEnd;
      }
      
      createFuture(args) {
        _debugLog('[ComponentAsyncState#createFuture()] args', args);
        const { tableIdx, elemMeta, hostInjectFn } = args;
        if (tableIdx === undefined) { throw new Error("missing table idx while adding future"); }
        if (elemMeta === undefined) { throw new Error("missing element metadata while adding future"); }
        
        const { table: futureTable, componentIdx } = FUTURE_TABLES[tableIdx];
        if (!futureTable) {
          throw new Error(`missing global future table lookup for table [${tableIdx}] while creating future`);
        }
        if (componentIdx !== this.#componentIdx) {
          throw new Error('component idx mismatch while creating future');
        }
        
        const readWaitable = this.createWaitable();
        const writeWaitable = this.createWaitable();
        
        const future = new InternalFuture({
          tableIdx,
          componentIdx: this.#componentIdx,
          elemMeta,
          readWaitable,
          writeWaitable,
          hostInjectFn,
        });
        future.setGlobalFutureMapRep(FUTURES.insert(future));
        
        const writeEnd = future.writeEnd();
        writeEnd.setWaitableIdx(this.handles.insert(writeEnd));
        writeEnd.setHandle(futureTable.insert(writeEnd));
        if (writeEnd.futureTableIdx() !== tableIdx) { throw new Error("unexpectedly mismatched future table"); }
        
        const writeEndWaitableIdx = writeEnd.waitableIdx();
        const writeEndHandle = writeEnd.handle();
        writeWaitable.setTarget(`waitable for future write end (waitable [${writeEndWaitableIdx}])`);
        writeEnd.setTarget(`future write end (waitable [${writeEndWaitableIdx}])`);
        
        const readEnd = future.readEnd();
        readEnd.setWaitableIdx(this.handles.insert(readEnd));
        readEnd.setHandle(futureTable.insert(readEnd));
        if (readEnd.futureTableIdx() !== tableIdx) { throw new Error("unexpectedly mismatched future table"); }
        
        const readEndWaitableIdx = readEnd.waitableIdx();
        const readEndHandle = readEnd.handle();
        readWaitable.setTarget(`waitable for read end (waitable [${readEndWaitableIdx}])`);
        readEnd.setTarget(`future read end (waitable [${readEndWaitableIdx}])`);
        
        return {
          writeEnd,
          writeEndWaitableIdx,
          writeEndHandle,
          readEndWaitableIdx,
          readEndHandle,
          readEnd,
        };
      }
      
      getFutureEnd(args) {
        _debugLog('[ComponentAsyncState#getFutureEnd()] args', args);
        const { tableIdx, futureEndHandle, futureEndWaitableIdx } = args;
        if (tableIdx === undefined) {
          throw new Error('missing table idx while getting future end');
        }
        
        const { table, componentIdx } = FUTURE_TABLES[tableIdx];
        const cstate = getOrCreateAsyncState(componentIdx);
        
        let futureEnd;
        if (futureEndWaitableIdx !== undefined) {
          futureEnd = cstate.handles.get(futureEndWaitableIdx);
        } else if (futureEndHandle !== undefined) {
          if (!table) { throw new Error(`missing/invalid table [${tableIdx}] while getting future end`); }
          futureEnd = table.get(futureEndHandle);
        } else {
          throw new TypeError("must specify either waitable idx or handle to retrieve future");
        }
        
        if (!futureEnd) {
          throw new Error(`missing future end (tableIdx [${tableIdx}], handle [${futureEndHandle}], waitableIdx [${futureEndWaitableIdx}])`);
        }
        if (tableIdx && futureEnd.futureTableIdx() !== tableIdx) {
          throw new Error(`future end table idx [${futureEnd.futureTableIdx()}] does not match [${tableIdx}]`);
        }
        
        return futureEnd;
      }
      
      removeFutureEndFromTable(args) {
        _debugLog('[ComponentAsyncState#removeFutureEndFromTable()] args', args);
        
        const { tableIdx, futureWaitableIdx } = args;
        if (tableIdx === undefined) { throw new Error("missing table idx while removing future end"); }
        if (futureWaitableIdx === undefined) {
          throw new Error("missing future end waitable idx while removing future end");
        }
        
        const { table, componentIdx } = FUTURE_TABLES[tableIdx];
        if (!table) { throw new Error(`missing/invalid table [${tableIdx}] while removing future end`); }
        
        const cstate = getOrCreateAsyncState(componentIdx);
        
        const futureEnd = cstate.handles.get(futureWaitableIdx);
        if (!futureEnd) {
          throw new Error(`missing future end (handle [${futureWaitableIdx}], table [${tableIdx}])`);
        }
        const handle = futureEnd.handle();
        
        let removed = cstate.handles.remove(futureWaitableIdx);
        if (!removed) {
          throw new Error(`failed to remove futureEnd from handles (waitable idx [${futureWaitableIdx}]), component [${componentIdx}])`);
        }
        
        removed = table.remove(handle);
        if (!removed) {
          throw new Error(`failed to remove futureEnd from table (handle [${handle}]), table [${tableIdx}], component [${componentIdx}])`);
        }
        
        return futureEnd;
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
    
    const isLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
    
    const hasOwnProperty = Object.prototype.hasOwnProperty;
    
    
    if (!getCoreModule) getCoreModule = (name) => fetchCompile(new URL(`./${name}`, import.meta.url));
    const module0 = getCoreModule('enrichment_provider.core.wasm');
    const module1 = getCoreModule('enrichment_provider.core2.wasm');
    const module2 = getCoreModule('enrichment_provider.core3.wasm');
    
    const { callPlugin, emitTelemetry, getIdentity, getNode, getPluginApi, queryNodes, requestPermission, storeNode } = imports['refarm:plugin/tractor-bridge'];
    
    if (callPlugin=== undefined) {
      const err = new Error("unexpectedly undefined instance import 'callPlugin', was 'callPlugin' available at instantiation?");
      console.error("ERROR:", err.toString());
      throw err;
    }
    
    callPlugin._isHostProvided = true;
    
    if (emitTelemetry=== undefined) {
      const err = new Error("unexpectedly undefined instance import 'emitTelemetry', was 'emitTelemetry' available at instantiation?");
      console.error("ERROR:", err.toString());
      throw err;
    }
    
    emitTelemetry._isHostProvided = true;
    
    if (getIdentity=== undefined) {
      const err = new Error("unexpectedly undefined instance import 'getIdentity', was 'getIdentity' available at instantiation?");
      console.error("ERROR:", err.toString());
      throw err;
    }
    
    getIdentity._isHostProvided = true;
    
    if (getNode=== undefined) {
      const err = new Error("unexpectedly undefined instance import 'getNode', was 'getNode' available at instantiation?");
      console.error("ERROR:", err.toString());
      throw err;
    }
    
    getNode._isHostProvided = true;
    
    if (getPluginApi=== undefined) {
      const err = new Error("unexpectedly undefined instance import 'getPluginApi', was 'getPluginApi' available at instantiation?");
      console.error("ERROR:", err.toString());
      throw err;
    }
    
    getPluginApi._isHostProvided = true;
    
    if (queryNodes=== undefined) {
      const err = new Error("unexpectedly undefined instance import 'queryNodes', was 'queryNodes' available at instantiation?");
      console.error("ERROR:", err.toString());
      throw err;
    }
    
    queryNodes._isHostProvided = true;
    
    if (requestPermission=== undefined) {
      const err = new Error("unexpectedly undefined instance import 'requestPermission', was 'requestPermission' available at instantiation?");
      console.error("ERROR:", err.toString());
      throw err;
    }
    
    requestPermission._isHostProvided = true;
    
    if (storeNode=== undefined) {
      const err = new Error("unexpectedly undefined instance import 'storeNode', was 'storeNode' available at instantiation?");
      console.error("ERROR:", err.toString());
      throw err;
    }
    
    storeNode._isHostProvided = true;
    let gen = (function* _initGenerator () {
      let exports0;
      let exports1;
      let memory0;
      let realloc0;
      let realloc0Async;
      
      const _trampoline0 = function(arg0, arg1, arg2) {
        var ptr0 = arg0;
        var len0 = arg1;
        var result0 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr0, len0));
        _debugLog('[iface="refarm:plugin/tractor-bridge@0.1.0", function="store-node"] [Instruction::CallInterface] (sync, @ enter)');
        let hostProvided = true;
        
        let parentTask;
        let task;
        let subtask;
        
        const createTask = () => {
          const results = createNewCurrentTask({
            componentIdx: -1, // 0,
            isAsync: false,
            entryFnName: 'storeNode',
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
          
          if (hostProvided) {
            subtask = parentTask.getLatestSubtask();
            if (!subtask) {
              throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
            }
            task.setParentSubtask(subtask);
          }
        }
        
        const started = task.enterSync();
        
        let ret;
        try {
          ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
            componentIdx: task.componentIdx(),
            taskID: task.id(),
            fn: () => storeNode(result0)
          })
        };
      } catch (e) {
        ret = { tag: 'err', val: getErrorPayload(e) };
      }
      
      var variant7 = ret;
      switch (variant7.tag) {
        case 'ok': {
          const e = variant7.val;
          dataView(memory0).setInt8(arg2 + 0, 0, true);
          
          var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
          var ptr1= encodeRes.ptr;
          var len1 = encodeRes.len;
          
          dataView(memory0).setUint32(arg2 + 8, len1, true);
          dataView(memory0).setUint32(arg2 + 4, ptr1, true);
          
          break;
        }
        case 'err': {
          const e = variant7.val;
          dataView(memory0).setInt8(arg2 + 0, 1, true);
          var variant6 = e;
          switch (variant6.tag) {
            case 'not-permitted': {
              const e = variant6.val;
              dataView(memory0).setInt8(arg2 + 4, 0, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr2= encodeRes.ptr;
              var len2 = encodeRes.len;
              
              dataView(memory0).setUint32(arg2 + 12, len2, true);
              dataView(memory0).setUint32(arg2 + 8, ptr2, true);
              break;
            }
            case 'not-found': {
              const e = variant6.val;
              dataView(memory0).setInt8(arg2 + 4, 1, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr3= encodeRes.ptr;
              var len3 = encodeRes.len;
              
              dataView(memory0).setUint32(arg2 + 12, len3, true);
              dataView(memory0).setUint32(arg2 + 8, ptr3, true);
              break;
            }
            case 'invalid-schema': {
              const e = variant6.val;
              dataView(memory0).setInt8(arg2 + 4, 2, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr4= encodeRes.ptr;
              var len4 = encodeRes.len;
              
              dataView(memory0).setUint32(arg2 + 12, len4, true);
              dataView(memory0).setUint32(arg2 + 8, ptr4, true);
              break;
            }
            case 'internal': {
              const e = variant6.val;
              dataView(memory0).setInt8(arg2 + 4, 3, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr5= encodeRes.ptr;
              var len5 = encodeRes.len;
              
              dataView(memory0).setUint32(arg2 + 12, len5, true);
              dataView(memory0).setUint32(arg2 + 8, ptr5, true);
              break;
            }
            default: {
              throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant6.tag)}\` (received \`${variant6}\`) specified for \`PluginError\``);
            }
          }
          
          break;
        }
        default: {
          _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant7, valueType: typeof variant7});
          throw new TypeError('invalid variant specified for result');
        }
      }
      _debugLog('[iface="refarm:plugin/tractor-bridge@0.1.0", function="store-node"][Instruction::Return]', {
        funcName: 'store-node',
        paramCount: 0,
        async: false,
        postReturn: false
      });
      task.resolve([ret]);
      task.exit();
    }
    _trampoline0.fnName = 'refarm:plugin/tractor-bridge@0.1.0#storeNode';
    
    const _trampoline1 = function(arg0, arg1, arg2) {
      var ptr0 = arg0;
      var len0 = arg1;
      var result0 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr0, len0));
      _debugLog('[iface="refarm:plugin/tractor-bridge@0.1.0", function="get-node"] [Instruction::CallInterface] (sync, @ enter)');
      let hostProvided = true;
      
      let parentTask;
      let task;
      let subtask;
      
      const createTask = () => {
        const results = createNewCurrentTask({
          componentIdx: -1, // 0,
          isAsync: false,
          entryFnName: 'getNode',
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
        
        if (hostProvided) {
          subtask = parentTask.getLatestSubtask();
          if (!subtask) {
            throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
          }
          task.setParentSubtask(subtask);
        }
      }
      
      const started = task.enterSync();
      
      let ret;
      try {
        ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
          componentIdx: task.componentIdx(),
          taskID: task.id(),
          fn: () => getNode(result0)
        })
      };
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    var variant7 = ret;
    switch (variant7.tag) {
      case 'ok': {
        const e = variant7.val;
        dataView(memory0).setInt8(arg2 + 0, 0, true);
        
        var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
        var ptr1= encodeRes.ptr;
        var len1 = encodeRes.len;
        
        dataView(memory0).setUint32(arg2 + 8, len1, true);
        dataView(memory0).setUint32(arg2 + 4, ptr1, true);
        
        break;
      }
      case 'err': {
        const e = variant7.val;
        dataView(memory0).setInt8(arg2 + 0, 1, true);
        var variant6 = e;
        switch (variant6.tag) {
          case 'not-permitted': {
            const e = variant6.val;
            dataView(memory0).setInt8(arg2 + 4, 0, true);
            
            var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
            var ptr2= encodeRes.ptr;
            var len2 = encodeRes.len;
            
            dataView(memory0).setUint32(arg2 + 12, len2, true);
            dataView(memory0).setUint32(arg2 + 8, ptr2, true);
            break;
          }
          case 'not-found': {
            const e = variant6.val;
            dataView(memory0).setInt8(arg2 + 4, 1, true);
            
            var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
            var ptr3= encodeRes.ptr;
            var len3 = encodeRes.len;
            
            dataView(memory0).setUint32(arg2 + 12, len3, true);
            dataView(memory0).setUint32(arg2 + 8, ptr3, true);
            break;
          }
          case 'invalid-schema': {
            const e = variant6.val;
            dataView(memory0).setInt8(arg2 + 4, 2, true);
            
            var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
            var ptr4= encodeRes.ptr;
            var len4 = encodeRes.len;
            
            dataView(memory0).setUint32(arg2 + 12, len4, true);
            dataView(memory0).setUint32(arg2 + 8, ptr4, true);
            break;
          }
          case 'internal': {
            const e = variant6.val;
            dataView(memory0).setInt8(arg2 + 4, 3, true);
            
            var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
            var ptr5= encodeRes.ptr;
            var len5 = encodeRes.len;
            
            dataView(memory0).setUint32(arg2 + 12, len5, true);
            dataView(memory0).setUint32(arg2 + 8, ptr5, true);
            break;
          }
          default: {
            throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant6.tag)}\` (received \`${variant6}\`) specified for \`PluginError\``);
          }
        }
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant7, valueType: typeof variant7});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="refarm:plugin/tractor-bridge@0.1.0", function="get-node"][Instruction::Return]', {
      funcName: 'get-node',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline1.fnName = 'refarm:plugin/tractor-bridge@0.1.0#getNode';
  
  const _trampoline2 = function(arg0, arg1, arg2, arg3) {
    var ptr0 = arg0;
    var len0 = arg1;
    var result0 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr0, len0));
    _debugLog('[iface="refarm:plugin/tractor-bridge@0.1.0", function="query-nodes"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1, // 0,
        isAsync: false,
        entryFnName: 'queryNodes',
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
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => queryNodes(result0, arg2 >>> 0)
      })
    };
  } catch (e) {
    ret = { tag: 'err', val: getErrorPayload(e) };
  }
  
  var variant8 = ret;
  switch (variant8.tag) {
    case 'ok': {
      const e = variant8.val;
      dataView(memory0).setInt8(arg3 + 0, 0, true);
      var vec2 = e;
      var len2 = vec2.length;
      var result2 = realloc0(0, 0, 4, len2 * 8);
      for (let i = 0; i < vec2.length; i++) {
        const e = vec2[i];
        const base = result2 + i * 8;
        var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
        var ptr1= encodeRes.ptr;
        var len1 = encodeRes.len;
        
        dataView(memory0).setUint32(base + 4, len1, true);
        dataView(memory0).setUint32(base + 0, ptr1, true);
      }
      dataView(memory0).setUint32(arg3 + 8, len2, true);
      dataView(memory0).setUint32(arg3 + 4, result2, true);
      
      break;
    }
    case 'err': {
      const e = variant8.val;
      dataView(memory0).setInt8(arg3 + 0, 1, true);
      var variant7 = e;
      switch (variant7.tag) {
        case 'not-permitted': {
          const e = variant7.val;
          dataView(memory0).setInt8(arg3 + 4, 0, true);
          
          var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
          var ptr3= encodeRes.ptr;
          var len3 = encodeRes.len;
          
          dataView(memory0).setUint32(arg3 + 12, len3, true);
          dataView(memory0).setUint32(arg3 + 8, ptr3, true);
          break;
        }
        case 'not-found': {
          const e = variant7.val;
          dataView(memory0).setInt8(arg3 + 4, 1, true);
          
          var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
          var ptr4= encodeRes.ptr;
          var len4 = encodeRes.len;
          
          dataView(memory0).setUint32(arg3 + 12, len4, true);
          dataView(memory0).setUint32(arg3 + 8, ptr4, true);
          break;
        }
        case 'invalid-schema': {
          const e = variant7.val;
          dataView(memory0).setInt8(arg3 + 4, 2, true);
          
          var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
          var ptr5= encodeRes.ptr;
          var len5 = encodeRes.len;
          
          dataView(memory0).setUint32(arg3 + 12, len5, true);
          dataView(memory0).setUint32(arg3 + 8, ptr5, true);
          break;
        }
        case 'internal': {
          const e = variant7.val;
          dataView(memory0).setInt8(arg3 + 4, 3, true);
          
          var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
          var ptr6= encodeRes.ptr;
          var len6 = encodeRes.len;
          
          dataView(memory0).setUint32(arg3 + 12, len6, true);
          dataView(memory0).setUint32(arg3 + 8, ptr6, true);
          break;
        }
        default: {
          throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant7.tag)}\` (received \`${variant7}\`) specified for \`PluginError\``);
        }
      }
      
      break;
    }
    default: {
      _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant8, valueType: typeof variant8});
      throw new TypeError('invalid variant specified for result');
    }
  }
  _debugLog('[iface="refarm:plugin/tractor-bridge@0.1.0", function="query-nodes"][Instruction::Return]', {
    funcName: 'query-nodes',
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
}
_trampoline2.fnName = 'refarm:plugin/tractor-bridge@0.1.0#queryNodes';

const _trampoline3 = function(arg0, arg1, arg2, arg3) {
  var ptr0 = arg0;
  var len0 = arg1;
  var result0 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr0, len0));
  var ptr1 = arg2;
  var len1 = arg3;
  var result1 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr1, len1));
  _debugLog('[iface="refarm:plugin/tractor-bridge@0.1.0", function="request-permission"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
  let parentTask;
  let task;
  let subtask;
  
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1, // 0,
      isAsync: false,
      entryFnName: 'requestPermission',
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
    
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  
  const started = task.enterSync();
  let ret = _withGlobalCurrentTaskMeta({
    componentIdx: task.componentIdx(),
    taskID: task.id(),
    fn: () => requestPermission(result0, result1)
  })
  ;
  _debugLog('[iface="refarm:plugin/tractor-bridge@0.1.0", function="request-permission"][Instruction::Return]', {
    funcName: 'request-permission',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([ret ? 1 : 0]);
  task.exit();
  return ret ? 1 : 0;
}
_trampoline3.fnName = 'refarm:plugin/tractor-bridge@0.1.0#requestPermission';

const _trampoline4 = function(arg0) {
  _debugLog('[iface="refarm:plugin/tractor-bridge@0.1.0", function="get-identity"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
  let parentTask;
  let task;
  let subtask;
  
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1, // 0,
      isAsync: false,
      entryFnName: 'getIdentity',
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
    
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  
  const started = task.enterSync();
  
  let ret;
  try {
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => getIdentity()
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

var variant9 = ret;
switch (variant9.tag) {
  case 'ok': {
    const e = variant9.val;
    dataView(memory0).setInt8(arg0 + 0, 0, true);
    var {identityType: v0_0, storageTier: v0_1, identifier: v0_2 } = e;
    
    var encodeRes = _utf8AllocateAndEncode(v0_0, realloc0, memory0);
    var ptr1= encodeRes.ptr;
    var len1 = encodeRes.len;
    
    dataView(memory0).setUint32(arg0 + 8, len1, true);
    dataView(memory0).setUint32(arg0 + 4, ptr1, true);
    
    var encodeRes = _utf8AllocateAndEncode(v0_1, realloc0, memory0);
    var ptr2= encodeRes.ptr;
    var len2 = encodeRes.len;
    
    dataView(memory0).setUint32(arg0 + 16, len2, true);
    dataView(memory0).setUint32(arg0 + 12, ptr2, true);
    
    var encodeRes = _utf8AllocateAndEncode(v0_2, realloc0, memory0);
    var ptr3= encodeRes.ptr;
    var len3 = encodeRes.len;
    
    dataView(memory0).setUint32(arg0 + 24, len3, true);
    dataView(memory0).setUint32(arg0 + 20, ptr3, true);
    
    break;
  }
  case 'err': {
    const e = variant9.val;
    dataView(memory0).setInt8(arg0 + 0, 1, true);
    var variant8 = e;
    switch (variant8.tag) {
      case 'not-permitted': {
        const e = variant8.val;
        dataView(memory0).setInt8(arg0 + 4, 0, true);
        
        var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
        var ptr4= encodeRes.ptr;
        var len4 = encodeRes.len;
        
        dataView(memory0).setUint32(arg0 + 12, len4, true);
        dataView(memory0).setUint32(arg0 + 8, ptr4, true);
        break;
      }
      case 'not-found': {
        const e = variant8.val;
        dataView(memory0).setInt8(arg0 + 4, 1, true);
        
        var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
        var ptr5= encodeRes.ptr;
        var len5 = encodeRes.len;
        
        dataView(memory0).setUint32(arg0 + 12, len5, true);
        dataView(memory0).setUint32(arg0 + 8, ptr5, true);
        break;
      }
      case 'invalid-schema': {
        const e = variant8.val;
        dataView(memory0).setInt8(arg0 + 4, 2, true);
        
        var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
        var ptr6= encodeRes.ptr;
        var len6 = encodeRes.len;
        
        dataView(memory0).setUint32(arg0 + 12, len6, true);
        dataView(memory0).setUint32(arg0 + 8, ptr6, true);
        break;
      }
      case 'internal': {
        const e = variant8.val;
        dataView(memory0).setInt8(arg0 + 4, 3, true);
        
        var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
        var ptr7= encodeRes.ptr;
        var len7 = encodeRes.len;
        
        dataView(memory0).setUint32(arg0 + 12, len7, true);
        dataView(memory0).setUint32(arg0 + 8, ptr7, true);
        break;
      }
      default: {
        throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant8.tag)}\` (received \`${variant8}\`) specified for \`PluginError\``);
      }
    }
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant9, valueType: typeof variant9});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="refarm:plugin/tractor-bridge@0.1.0", function="get-identity"][Instruction::Return]', {
  funcName: 'get-identity',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline4.fnName = 'refarm:plugin/tractor-bridge@0.1.0#getIdentity';

const _trampoline5 = function(arg0, arg1, arg2) {
  var ptr0 = arg0;
  var len0 = arg1;
  var result0 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr0, len0));
  _debugLog('[iface="refarm:plugin/tractor-bridge@0.1.0", function="get-plugin-api"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
  let parentTask;
  let task;
  let subtask;
  
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1, // 0,
      isAsync: false,
      entryFnName: 'getPluginApi',
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
    
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  
  const started = task.enterSync();
  
  let ret;
  try {
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => getPluginApi(result0)
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

var variant7 = ret;
switch (variant7.tag) {
  case 'ok': {
    const e = variant7.val;
    dataView(memory0).setInt8(arg2 + 0, 0, true);
    
    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
    var ptr1= encodeRes.ptr;
    var len1 = encodeRes.len;
    
    dataView(memory0).setUint32(arg2 + 8, len1, true);
    dataView(memory0).setUint32(arg2 + 4, ptr1, true);
    
    break;
  }
  case 'err': {
    const e = variant7.val;
    dataView(memory0).setInt8(arg2 + 0, 1, true);
    var variant6 = e;
    switch (variant6.tag) {
      case 'not-permitted': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg2 + 4, 0, true);
        
        var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
        var ptr2= encodeRes.ptr;
        var len2 = encodeRes.len;
        
        dataView(memory0).setUint32(arg2 + 12, len2, true);
        dataView(memory0).setUint32(arg2 + 8, ptr2, true);
        break;
      }
      case 'not-found': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg2 + 4, 1, true);
        
        var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
        var ptr3= encodeRes.ptr;
        var len3 = encodeRes.len;
        
        dataView(memory0).setUint32(arg2 + 12, len3, true);
        dataView(memory0).setUint32(arg2 + 8, ptr3, true);
        break;
      }
      case 'invalid-schema': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg2 + 4, 2, true);
        
        var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
        var ptr4= encodeRes.ptr;
        var len4 = encodeRes.len;
        
        dataView(memory0).setUint32(arg2 + 12, len4, true);
        dataView(memory0).setUint32(arg2 + 8, ptr4, true);
        break;
      }
      case 'internal': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg2 + 4, 3, true);
        
        var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
        var ptr5= encodeRes.ptr;
        var len5 = encodeRes.len;
        
        dataView(memory0).setUint32(arg2 + 12, len5, true);
        dataView(memory0).setUint32(arg2 + 8, ptr5, true);
        break;
      }
      default: {
        throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant6.tag)}\` (received \`${variant6}\`) specified for \`PluginError\``);
      }
    }
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant7, valueType: typeof variant7});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="refarm:plugin/tractor-bridge@0.1.0", function="get-plugin-api"][Instruction::Return]', {
  funcName: 'get-plugin-api',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline5.fnName = 'refarm:plugin/tractor-bridge@0.1.0#getPluginApi';

const _trampoline6 = function(arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
  var ptr0 = arg0;
  var len0 = arg1;
  var result0 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr0, len0));
  var ptr1 = arg2;
  var len1 = arg3;
  var result1 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr1, len1));
  var ptr2 = arg4;
  var len2 = arg5;
  var result2 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr2, len2));
  _debugLog('[iface="refarm:plugin/tractor-bridge@0.1.0", function="call-plugin"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
  let parentTask;
  let task;
  let subtask;
  
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1, // 0,
      isAsync: false,
      entryFnName: 'callPlugin',
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
    
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  
  const started = task.enterSync();
  
  let ret;
  try {
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => callPlugin(result0, result1, result2)
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

var variant9 = ret;
switch (variant9.tag) {
  case 'ok': {
    const e = variant9.val;
    dataView(memory0).setInt8(arg6 + 0, 0, true);
    
    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
    var ptr3= encodeRes.ptr;
    var len3 = encodeRes.len;
    
    dataView(memory0).setUint32(arg6 + 8, len3, true);
    dataView(memory0).setUint32(arg6 + 4, ptr3, true);
    
    break;
  }
  case 'err': {
    const e = variant9.val;
    dataView(memory0).setInt8(arg6 + 0, 1, true);
    var variant8 = e;
    switch (variant8.tag) {
      case 'not-permitted': {
        const e = variant8.val;
        dataView(memory0).setInt8(arg6 + 4, 0, true);
        
        var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
        var ptr4= encodeRes.ptr;
        var len4 = encodeRes.len;
        
        dataView(memory0).setUint32(arg6 + 12, len4, true);
        dataView(memory0).setUint32(arg6 + 8, ptr4, true);
        break;
      }
      case 'not-found': {
        const e = variant8.val;
        dataView(memory0).setInt8(arg6 + 4, 1, true);
        
        var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
        var ptr5= encodeRes.ptr;
        var len5 = encodeRes.len;
        
        dataView(memory0).setUint32(arg6 + 12, len5, true);
        dataView(memory0).setUint32(arg6 + 8, ptr5, true);
        break;
      }
      case 'invalid-schema': {
        const e = variant8.val;
        dataView(memory0).setInt8(arg6 + 4, 2, true);
        
        var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
        var ptr6= encodeRes.ptr;
        var len6 = encodeRes.len;
        
        dataView(memory0).setUint32(arg6 + 12, len6, true);
        dataView(memory0).setUint32(arg6 + 8, ptr6, true);
        break;
      }
      case 'internal': {
        const e = variant8.val;
        dataView(memory0).setInt8(arg6 + 4, 3, true);
        
        var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
        var ptr7= encodeRes.ptr;
        var len7 = encodeRes.len;
        
        dataView(memory0).setUint32(arg6 + 12, len7, true);
        dataView(memory0).setUint32(arg6 + 8, ptr7, true);
        break;
      }
      default: {
        throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant8.tag)}\` (received \`${variant8}\`) specified for \`PluginError\``);
      }
    }
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant9, valueType: typeof variant9});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="refarm:plugin/tractor-bridge@0.1.0", function="call-plugin"][Instruction::Return]', {
  funcName: 'call-plugin',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline6.fnName = 'refarm:plugin/tractor-bridge@0.1.0#callPlugin';

const _trampoline7 = function(arg0, arg1, arg2, arg3, arg4) {
  var ptr0 = arg0;
  var len0 = arg1;
  var result0 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr0, len0));
  let variant2;
  switch (arg2) {
    case 0: {
      variant2 = undefined;
      break;
    }
    case 1: {
      var ptr1 = arg3;
      var len1 = arg4;
      var result1 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr1, len1));
      variant2 = result1;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="refarm:plugin/tractor-bridge@0.1.0", function="emit-telemetry"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
  let parentTask;
  let task;
  let subtask;
  
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1, // 0,
      isAsync: false,
      entryFnName: 'emitTelemetry',
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
    
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  
  const started = task.enterSync();
  let ret;_withGlobalCurrentTaskMeta({
    componentIdx: task.componentIdx(),
    taskID: task.id(),
    fn: () => emitTelemetry(result0, variant2)
  })
  ;
  _debugLog('[iface="refarm:plugin/tractor-bridge@0.1.0", function="emit-telemetry"][Instruction::Return]', {
    funcName: 'emit-telemetry',
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
}
_trampoline7.fnName = 'refarm:plugin/tractor-bridge@0.1.0#emitTelemetry';
let exports2;
let postReturn0;
let postReturn0Async;
let postReturn1;
let postReturn1Async;
let postReturn2;
let postReturn2Async;
let postReturn3;
let postReturn3Async;
let postReturn4;
let postReturn4Async;
let postReturn5;
let postReturn5Async;
let postReturn6;
let postReturn6Async;
let postReturn7;
let postReturn7Async;
let integration010Setup;

function setup() {
  _debugLog('[iface="refarm:plugin/integration@0.1.0", function="setup"][Instruction::CallWasm] enter', {
    funcName: 'setup',
    paramCount: 0,
    async: false,
    postReturn: true,
  });
  const hostProvided = false;
  
  const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
    componentIdx: 0,
    isAsync: false,
    isManualAsync: false,
    entryFnName: 'integration010Setup',
    getCallbackFn: () => null,
    callbackFnName: 'null',
    errHandling: 'throw-result-err',
    callingWasmExport: true,
  });
  
  const started = task.enterSync();
  task.setReturnMemoryIdx(0);
  task.setReturnMemory(memory0);
  let ret =   _withGlobalCurrentTaskMeta({
    taskID: task.id(),
    componentIdx: task.componentIdx(),
    fn: () => integration010Setup(),
  });
  
  let variant5;
  switch (dataView(memory0).getUint8(ret + 0, true)) {
    case 0: {
      variant5= {
        tag: 'ok',
        val: undefined
      };
      break;
    }
    case 1: {
      let variant4;
      switch (dataView(memory0).getUint8(ret + 4, true)) {
        case 0: {
          var ptr0 = dataView(memory0).getUint32(ret + 8, true);
          var len0 = dataView(memory0).getUint32(ret + 12, true);
          var result0 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr0, len0));
          variant4= {
            tag: 'not-permitted',
            val: result0
          };
          break;
        }
        case 1: {
          var ptr1 = dataView(memory0).getUint32(ret + 8, true);
          var len1 = dataView(memory0).getUint32(ret + 12, true);
          var result1 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr1, len1));
          variant4= {
            tag: 'not-found',
            val: result1
          };
          break;
        }
        case 2: {
          var ptr2 = dataView(memory0).getUint32(ret + 8, true);
          var len2 = dataView(memory0).getUint32(ret + 12, true);
          var result2 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr2, len2));
          variant4= {
            tag: 'invalid-schema',
            val: result2
          };
          break;
        }
        case 3: {
          var ptr3 = dataView(memory0).getUint32(ret + 8, true);
          var len3 = dataView(memory0).getUint32(ret + 12, true);
          var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
          variant4= {
            tag: 'internal',
            val: result3
          };
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for PluginError');
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
  _debugLog('[iface="refarm:plugin/integration@0.1.0", function="setup"][Instruction::Return]', {
    funcName: 'setup',
    paramCount: 1,
    async: false,
    postReturn: true
  });
  const retCopy = variant5;
  task.resolve([retCopy.val]);
  
  let cstate = getOrCreateAsyncState(0);
  cstate.mayLeave = false;
  postReturn0(ret);
  cstate.mayLeave = true;
  task.exit();
  
  
  
  if (typeof retCopy === 'object' && retCopy.tag === 'err') {
    throw new ComponentError(retCopy.val);
  }
  return retCopy.val;
  
}
let integration010Ingest;

function ingest() {
  _debugLog('[iface="refarm:plugin/integration@0.1.0", function="ingest"][Instruction::CallWasm] enter', {
    funcName: 'ingest',
    paramCount: 0,
    async: false,
    postReturn: true,
  });
  const hostProvided = false;
  
  const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
    componentIdx: 0,
    isAsync: false,
    isManualAsync: false,
    entryFnName: 'integration010Ingest',
    getCallbackFn: () => null,
    callbackFnName: 'null',
    errHandling: 'throw-result-err',
    callingWasmExport: true,
  });
  
  const started = task.enterSync();
  task.setReturnMemoryIdx(0);
  task.setReturnMemory(memory0);
  let ret =   _withGlobalCurrentTaskMeta({
    taskID: task.id(),
    componentIdx: task.componentIdx(),
    fn: () => integration010Ingest(),
  });
  
  let variant5;
  switch (dataView(memory0).getUint8(ret + 0, true)) {
    case 0: {
      variant5= {
        tag: 'ok',
        val: dataView(memory0).getInt32(ret + 4, true) >>> 0
      };
      break;
    }
    case 1: {
      let variant4;
      switch (dataView(memory0).getUint8(ret + 4, true)) {
        case 0: {
          var ptr0 = dataView(memory0).getUint32(ret + 8, true);
          var len0 = dataView(memory0).getUint32(ret + 12, true);
          var result0 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr0, len0));
          variant4= {
            tag: 'not-permitted',
            val: result0
          };
          break;
        }
        case 1: {
          var ptr1 = dataView(memory0).getUint32(ret + 8, true);
          var len1 = dataView(memory0).getUint32(ret + 12, true);
          var result1 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr1, len1));
          variant4= {
            tag: 'not-found',
            val: result1
          };
          break;
        }
        case 2: {
          var ptr2 = dataView(memory0).getUint32(ret + 8, true);
          var len2 = dataView(memory0).getUint32(ret + 12, true);
          var result2 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr2, len2));
          variant4= {
            tag: 'invalid-schema',
            val: result2
          };
          break;
        }
        case 3: {
          var ptr3 = dataView(memory0).getUint32(ret + 8, true);
          var len3 = dataView(memory0).getUint32(ret + 12, true);
          var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
          variant4= {
            tag: 'internal',
            val: result3
          };
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for PluginError');
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
  _debugLog('[iface="refarm:plugin/integration@0.1.0", function="ingest"][Instruction::Return]', {
    funcName: 'ingest',
    paramCount: 1,
    async: false,
    postReturn: true
  });
  const retCopy = variant5;
  task.resolve([retCopy.val]);
  
  let cstate = getOrCreateAsyncState(0);
  cstate.mayLeave = false;
  postReturn1(ret);
  cstate.mayLeave = true;
  task.exit();
  
  
  
  if (typeof retCopy === 'object' && retCopy.tag === 'err') {
    throw new ComponentError(retCopy.val);
  }
  return retCopy.val;
  
}
let integration010Push;

function push(arg0) {
  
  var encodeRes = _utf8AllocateAndEncode(arg0, realloc0, memory0);
  var ptr0= encodeRes.ptr;
  var len0 = encodeRes.len;
  
  _debugLog('[iface="refarm:plugin/integration@0.1.0", function="push"][Instruction::CallWasm] enter', {
    funcName: 'push',
    paramCount: 2,
    async: false,
    postReturn: true,
  });
  const hostProvided = false;
  
  const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
    componentIdx: 0,
    isAsync: false,
    isManualAsync: false,
    entryFnName: 'integration010Push',
    getCallbackFn: () => null,
    callbackFnName: 'null',
    errHandling: 'throw-result-err',
    callingWasmExport: true,
  });
  
  const started = task.enterSync();
  task.setReturnMemoryIdx(0);
  task.setReturnMemory(memory0);
  let ret =   _withGlobalCurrentTaskMeta({
    taskID: task.id(),
    componentIdx: task.componentIdx(),
    fn: () => integration010Push(ptr0, len0),
  });
  
  let variant6;
  switch (dataView(memory0).getUint8(ret + 0, true)) {
    case 0: {
      variant6= {
        tag: 'ok',
        val: undefined
      };
      break;
    }
    case 1: {
      let variant5;
      switch (dataView(memory0).getUint8(ret + 4, true)) {
        case 0: {
          var ptr1 = dataView(memory0).getUint32(ret + 8, true);
          var len1 = dataView(memory0).getUint32(ret + 12, true);
          var result1 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr1, len1));
          variant5= {
            tag: 'not-permitted',
            val: result1
          };
          break;
        }
        case 1: {
          var ptr2 = dataView(memory0).getUint32(ret + 8, true);
          var len2 = dataView(memory0).getUint32(ret + 12, true);
          var result2 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr2, len2));
          variant5= {
            tag: 'not-found',
            val: result2
          };
          break;
        }
        case 2: {
          var ptr3 = dataView(memory0).getUint32(ret + 8, true);
          var len3 = dataView(memory0).getUint32(ret + 12, true);
          var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
          variant5= {
            tag: 'invalid-schema',
            val: result3
          };
          break;
        }
        case 3: {
          var ptr4 = dataView(memory0).getUint32(ret + 8, true);
          var len4 = dataView(memory0).getUint32(ret + 12, true);
          var result4 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr4, len4));
          variant5= {
            tag: 'internal',
            val: result4
          };
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for PluginError');
        }
      }
      variant6= {
        tag: 'err',
        val: variant5
      };
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for expected');
    }
  }
  _debugLog('[iface="refarm:plugin/integration@0.1.0", function="push"][Instruction::Return]', {
    funcName: 'push',
    paramCount: 1,
    async: false,
    postReturn: true
  });
  const retCopy = variant6;
  task.resolve([retCopy.val]);
  
  let cstate = getOrCreateAsyncState(0);
  cstate.mayLeave = false;
  postReturn2(ret);
  cstate.mayLeave = true;
  task.exit();
  
  
  
  if (typeof retCopy === 'object' && retCopy.tag === 'err') {
    throw new ComponentError(retCopy.val);
  }
  return retCopy.val;
  
}
let integration010Teardown;

function teardown() {
  _debugLog('[iface="refarm:plugin/integration@0.1.0", function="teardown"][Instruction::CallWasm] enter', {
    funcName: 'teardown',
    paramCount: 0,
    async: false,
    postReturn: true,
  });
  const hostProvided = false;
  
  const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
    componentIdx: 0,
    isAsync: false,
    isManualAsync: false,
    entryFnName: 'integration010Teardown',
    getCallbackFn: () => null,
    callbackFnName: 'null',
    errHandling: 'none',
    callingWasmExport: true,
  });
  
  const started = task.enterSync();
  let ret;  _withGlobalCurrentTaskMeta({
    taskID: task.id(),
    componentIdx: task.componentIdx(),
    fn: () => integration010Teardown(),
  });
  
  _debugLog('[iface="refarm:plugin/integration@0.1.0", function="teardown"][Instruction::Return]', {
    funcName: 'teardown',
    paramCount: 0,
    async: false,
    postReturn: true
  });
  task.resolve([ret]);
  
  let cstate = getOrCreateAsyncState(0);
  cstate.mayLeave = false;
  postReturn3();
  cstate.mayLeave = true;
  task.exit();
  
  
}
let integration010GetHelpNodes;

function getHelpNodes() {
  _debugLog('[iface="refarm:plugin/integration@0.1.0", function="get-help-nodes"][Instruction::CallWasm] enter', {
    funcName: 'get-help-nodes',
    paramCount: 0,
    async: false,
    postReturn: true,
  });
  const hostProvided = false;
  
  const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
    componentIdx: 0,
    isAsync: false,
    isManualAsync: false,
    entryFnName: 'integration010GetHelpNodes',
    getCallbackFn: () => null,
    callbackFnName: 'null',
    errHandling: 'throw-result-err',
    callingWasmExport: true,
  });
  
  const started = task.enterSync();
  task.setReturnMemoryIdx(0);
  task.setReturnMemory(memory0);
  let ret =   _withGlobalCurrentTaskMeta({
    taskID: task.id(),
    componentIdx: task.componentIdx(),
    fn: () => integration010GetHelpNodes(),
  });
  
  let variant7;
  switch (dataView(memory0).getUint8(ret + 0, true)) {
    case 0: {
      var len1 = dataView(memory0).getUint32(ret + 8, true);
      var base1 = dataView(memory0).getUint32(ret + 4, true);
      var result1 = [];
      for (let i = 0; i < len1; i++) {
        const base = base1 + i * 8;
        var ptr0 = dataView(memory0).getUint32(base + 0, true);
        var len0 = dataView(memory0).getUint32(base + 4, true);
        var result0 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr0, len0));
        result1.push(result0);
      }
      variant7= {
        tag: 'ok',
        val: result1
      };
      break;
    }
    case 1: {
      let variant6;
      switch (dataView(memory0).getUint8(ret + 4, true)) {
        case 0: {
          var ptr2 = dataView(memory0).getUint32(ret + 8, true);
          var len2 = dataView(memory0).getUint32(ret + 12, true);
          var result2 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr2, len2));
          variant6= {
            tag: 'not-permitted',
            val: result2
          };
          break;
        }
        case 1: {
          var ptr3 = dataView(memory0).getUint32(ret + 8, true);
          var len3 = dataView(memory0).getUint32(ret + 12, true);
          var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
          variant6= {
            tag: 'not-found',
            val: result3
          };
          break;
        }
        case 2: {
          var ptr4 = dataView(memory0).getUint32(ret + 8, true);
          var len4 = dataView(memory0).getUint32(ret + 12, true);
          var result4 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr4, len4));
          variant6= {
            tag: 'invalid-schema',
            val: result4
          };
          break;
        }
        case 3: {
          var ptr5 = dataView(memory0).getUint32(ret + 8, true);
          var len5 = dataView(memory0).getUint32(ret + 12, true);
          var result5 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr5, len5));
          variant6= {
            tag: 'internal',
            val: result5
          };
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for PluginError');
        }
      }
      variant7= {
        tag: 'err',
        val: variant6
      };
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for expected');
    }
  }
  _debugLog('[iface="refarm:plugin/integration@0.1.0", function="get-help-nodes"][Instruction::Return]', {
    funcName: 'get-help-nodes',
    paramCount: 1,
    async: false,
    postReturn: true
  });
  const retCopy = variant7;
  task.resolve([retCopy.val]);
  
  let cstate = getOrCreateAsyncState(0);
  cstate.mayLeave = false;
  postReturn4(ret);
  cstate.mayLeave = true;
  task.exit();
  
  
  
  if (typeof retCopy === 'object' && retCopy.tag === 'err') {
    throw new ComponentError(retCopy.val);
  }
  return retCopy.val;
  
}
let integration010Metadata;

function metadata() {
  _debugLog('[iface="refarm:plugin/integration@0.1.0", function="metadata"][Instruction::CallWasm] enter', {
    funcName: 'metadata',
    paramCount: 0,
    async: false,
    postReturn: true,
  });
  const hostProvided = false;
  
  const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
    componentIdx: 0,
    isAsync: false,
    isManualAsync: false,
    entryFnName: 'integration010Metadata',
    getCallbackFn: () => null,
    callbackFnName: 'null',
    errHandling: 'none',
    callingWasmExport: true,
  });
  
  const started = task.enterSync();
  task.setReturnMemoryIdx(0);
  task.setReturnMemory(memory0);
  let ret =   _withGlobalCurrentTaskMeta({
    taskID: task.id(),
    componentIdx: task.componentIdx(),
    fn: () => integration010Metadata(),
  });
  
  var ptr0 = dataView(memory0).getUint32(ret + 0, true);
  var len0 = dataView(memory0).getUint32(ret + 4, true);
  var result0 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr0, len0));
  var ptr1 = dataView(memory0).getUint32(ret + 8, true);
  var len1 = dataView(memory0).getUint32(ret + 12, true);
  var result1 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr1, len1));
  var ptr2 = dataView(memory0).getUint32(ret + 16, true);
  var len2 = dataView(memory0).getUint32(ret + 20, true);
  var result2 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr2, len2));
  var len4 = dataView(memory0).getUint32(ret + 28, true);
  var base4 = dataView(memory0).getUint32(ret + 24, true);
  var result4 = [];
  for (let i = 0; i < len4; i++) {
    const base = base4 + i * 8;
    var ptr3 = dataView(memory0).getUint32(base + 0, true);
    var len3 = dataView(memory0).getUint32(base + 4, true);
    var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
    result4.push(result3);
  }
  var len6 = dataView(memory0).getUint32(ret + 36, true);
  var base6 = dataView(memory0).getUint32(ret + 32, true);
  var result6 = [];
  for (let i = 0; i < len6; i++) {
    const base = base6 + i * 8;
    var ptr5 = dataView(memory0).getUint32(base + 0, true);
    var len5 = dataView(memory0).getUint32(base + 4, true);
    var result5 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr5, len5));
    result6.push(result5);
  }
  _debugLog('[iface="refarm:plugin/integration@0.1.0", function="metadata"][Instruction::Return]', {
    funcName: 'metadata',
    paramCount: 1,
    async: false,
    postReturn: true
  });
  task.resolve([{
    name: result0,
    version: result1,
    description: result2,
    supportedTypes: result4,
    requiredCapabilities: result6,
  }]);
  const retCopy = {
    name: result0,
    version: result1,
    description: result2,
    supportedTypes: result4,
    requiredCapabilities: result6,
  };
  
  let cstate = getOrCreateAsyncState(0);
  cstate.mayLeave = false;
  postReturn5(ret);
  cstate.mayLeave = true;
  task.exit();
  return retCopy;
  
}
let integration010OnEvent;

function onEvent(arg0, arg1) {
  
  var encodeRes = _utf8AllocateAndEncode(arg0, realloc0, memory0);
  var ptr0= encodeRes.ptr;
  var len0 = encodeRes.len;
  
  var variant2 = arg1;
  let variant2_0;
  let variant2_1;
  let variant2_2;
  if (variant2 === null || variant2=== undefined) {
    variant2_0 = 0;
    variant2_1 = 0;
    variant2_2 = 0;
  } else {
    const e = variant2;
    
    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
    var ptr1= encodeRes.ptr;
    var len1 = encodeRes.len;
    
    variant2_0 = 1;
    variant2_1 = ptr1;
    variant2_2 = len1;
  }
  _debugLog('[iface="refarm:plugin/integration@0.1.0", function="on-event"][Instruction::CallWasm] enter', {
    funcName: 'on-event',
    paramCount: 5,
    async: false,
    postReturn: true,
  });
  const hostProvided = false;
  
  const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
    componentIdx: 0,
    isAsync: false,
    isManualAsync: false,
    entryFnName: 'integration010OnEvent',
    getCallbackFn: () => null,
    callbackFnName: 'null',
    errHandling: 'none',
    callingWasmExport: true,
  });
  
  const started = task.enterSync();
  task.setReturnMemoryIdx(0);
  task.setReturnMemory(memory0);
  let ret;  _withGlobalCurrentTaskMeta({
    taskID: task.id(),
    componentIdx: task.componentIdx(),
    fn: () => integration010OnEvent(ptr0, len0, variant2_0, variant2_1, variant2_2),
  });
  
  _debugLog('[iface="refarm:plugin/integration@0.1.0", function="on-event"][Instruction::Return]', {
    funcName: 'on-event',
    paramCount: 0,
    async: false,
    postReturn: true
  });
  task.resolve([ret]);
  
  let cstate = getOrCreateAsyncState(0);
  cstate.mayLeave = false;
  postReturn6();
  cstate.mayLeave = true;
  task.exit();
  
  
}
let integration010Respond;

function respond(arg0) {
  
  var encodeRes = _utf8AllocateAndEncode(arg0, realloc0, memory0);
  var ptr0= encodeRes.ptr;
  var len0 = encodeRes.len;
  
  _debugLog('[iface="refarm:plugin/integration@0.1.0", function="respond"][Instruction::CallWasm] enter', {
    funcName: 'respond',
    paramCount: 2,
    async: false,
    postReturn: true,
  });
  const hostProvided = false;
  
  const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
    componentIdx: 0,
    isAsync: false,
    isManualAsync: false,
    entryFnName: 'integration010Respond',
    getCallbackFn: () => null,
    callbackFnName: 'null',
    errHandling: 'throw-result-err',
    callingWasmExport: true,
  });
  
  const started = task.enterSync();
  task.setReturnMemoryIdx(0);
  task.setReturnMemory(memory0);
  let ret =   _withGlobalCurrentTaskMeta({
    taskID: task.id(),
    componentIdx: task.componentIdx(),
    fn: () => integration010Respond(ptr0, len0),
  });
  
  let variant7;
  switch (dataView(memory0).getUint8(ret + 0, true)) {
    case 0: {
      var ptr1 = dataView(memory0).getUint32(ret + 4, true);
      var len1 = dataView(memory0).getUint32(ret + 8, true);
      var result1 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr1, len1));
      variant7= {
        tag: 'ok',
        val: result1
      };
      break;
    }
    case 1: {
      let variant6;
      switch (dataView(memory0).getUint8(ret + 4, true)) {
        case 0: {
          var ptr2 = dataView(memory0).getUint32(ret + 8, true);
          var len2 = dataView(memory0).getUint32(ret + 12, true);
          var result2 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr2, len2));
          variant6= {
            tag: 'not-permitted',
            val: result2
          };
          break;
        }
        case 1: {
          var ptr3 = dataView(memory0).getUint32(ret + 8, true);
          var len3 = dataView(memory0).getUint32(ret + 12, true);
          var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
          variant6= {
            tag: 'not-found',
            val: result3
          };
          break;
        }
        case 2: {
          var ptr4 = dataView(memory0).getUint32(ret + 8, true);
          var len4 = dataView(memory0).getUint32(ret + 12, true);
          var result4 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr4, len4));
          variant6= {
            tag: 'invalid-schema',
            val: result4
          };
          break;
        }
        case 3: {
          var ptr5 = dataView(memory0).getUint32(ret + 8, true);
          var len5 = dataView(memory0).getUint32(ret + 12, true);
          var result5 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr5, len5));
          variant6= {
            tag: 'internal',
            val: result5
          };
          break;
        }
        default: {
          throw new TypeError('invalid variant discriminant for PluginError');
        }
      }
      variant7= {
        tag: 'err',
        val: variant6
      };
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for expected');
    }
  }
  _debugLog('[iface="refarm:plugin/integration@0.1.0", function="respond"][Instruction::Return]', {
    funcName: 'respond',
    paramCount: 1,
    async: false,
    postReturn: true
  });
  const retCopy = variant7;
  task.resolve([retCopy.val]);
  
  let cstate = getOrCreateAsyncState(0);
  cstate.mayLeave = false;
  postReturn7(ret);
  cstate.mayLeave = true;
  task.exit();
  
  
  
  if (typeof retCopy === 'object' && retCopy.tag === 'err') {
    throw new ComponentError(retCopy.val);
  }
  return retCopy.val;
  
}
let trampoline0 = _trampoline0.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 0,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline0.manuallyAsync,
  paramLiftFns: [_liftFlatStringAny],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatStringAny, 16, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'not-permitted', _lowerFlatStringAny, 12, 4, 4 ],[ 'not-found', _lowerFlatStringAny, 12, 4, 4 ],[ 'invalid-schema', _lowerFlatStringAny, 12, 4, 4 ],[ 'internal', _lowerFlatStringAny, 12, 4, 4 ],]), 16, 4, 4 ],
  ])
  ],
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: 0,
  stringEncoding: 'utf8',
  getMemoryFn: () => memory0,
  getReallocFn: () => realloc0,
  importFn: _trampoline0,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 0,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline0.manuallyAsync,
  paramLiftFns: [_liftFlatStringAny],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatStringAny, 16, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'not-permitted', _lowerFlatStringAny, 12, 4, 4 ],[ 'not-found', _lowerFlatStringAny, 12, 4, 4 ],[ 'invalid-schema', _lowerFlatStringAny, 12, 4, 4 ],[ 'internal', _lowerFlatStringAny, 12, 4, 4 ],]), 16, 4, 4 ],
  ])
  ],
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: 0,
  stringEncoding: 'utf8',
  getMemoryFn: () => memory0,
  getReallocFn: () => realloc0,
  importFn: _trampoline0,
},
);
let trampoline1 = _trampoline1.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 1,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline1.manuallyAsync,
  paramLiftFns: [_liftFlatStringAny],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatStringAny, 16, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'not-permitted', _lowerFlatStringAny, 12, 4, 4 ],[ 'not-found', _lowerFlatStringAny, 12, 4, 4 ],[ 'invalid-schema', _lowerFlatStringAny, 12, 4, 4 ],[ 'internal', _lowerFlatStringAny, 12, 4, 4 ],]), 16, 4, 4 ],
  ])
  ],
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: 0,
  stringEncoding: 'utf8',
  getMemoryFn: () => memory0,
  getReallocFn: () => realloc0,
  importFn: _trampoline1,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 1,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline1.manuallyAsync,
  paramLiftFns: [_liftFlatStringAny],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatStringAny, 16, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'not-permitted', _lowerFlatStringAny, 12, 4, 4 ],[ 'not-found', _lowerFlatStringAny, 12, 4, 4 ],[ 'invalid-schema', _lowerFlatStringAny, 12, 4, 4 ],[ 'internal', _lowerFlatStringAny, 12, 4, 4 ],]), 16, 4, 4 ],
  ])
  ],
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: 0,
  stringEncoding: 'utf8',
  getMemoryFn: () => memory0,
  getReallocFn: () => realloc0,
  importFn: _trampoline1,
},
);
let trampoline2 = _trampoline2.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 2,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline2.manuallyAsync,
  paramLiftFns: [_liftFlatStringAny,_liftFlatU32],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatList({
    elemLowerFn: _lowerFlatStringAny,
    elemSize32: 8,
    elemAlign32: 4,
  }), 16, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'not-permitted', _lowerFlatStringAny, 12, 4, 4 ],[ 'not-found', _lowerFlatStringAny, 12, 4, 4 ],[ 'invalid-schema', _lowerFlatStringAny, 12, 4, 4 ],[ 'internal', _lowerFlatStringAny, 12, 4, 4 ],]), 16, 4, 4 ],
  ])
  ],
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: 0,
  stringEncoding: 'utf8',
  getMemoryFn: () => memory0,
  getReallocFn: () => realloc0,
  importFn: _trampoline2,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 2,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline2.manuallyAsync,
  paramLiftFns: [_liftFlatStringAny,_liftFlatU32],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatList({
    elemLowerFn: _lowerFlatStringAny,
    elemSize32: 8,
    elemAlign32: 4,
  }), 16, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'not-permitted', _lowerFlatStringAny, 12, 4, 4 ],[ 'not-found', _lowerFlatStringAny, 12, 4, 4 ],[ 'invalid-schema', _lowerFlatStringAny, 12, 4, 4 ],[ 'internal', _lowerFlatStringAny, 12, 4, 4 ],]), 16, 4, 4 ],
  ])
  ],
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: 0,
  stringEncoding: 'utf8',
  getMemoryFn: () => memory0,
  getReallocFn: () => realloc0,
  importFn: _trampoline2,
},
);
let trampoline3 = _trampoline3.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 3,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline3.manuallyAsync,
  paramLiftFns: [_liftFlatStringAny,_liftFlatStringAny],
  resultLowerFns: [_lowerFlatBool],
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: 0,
  stringEncoding: 'utf8',
  getMemoryFn: () => memory0,
  getReallocFn: () => null,
  importFn: _trampoline3,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 3,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline3.manuallyAsync,
  paramLiftFns: [_liftFlatStringAny,_liftFlatStringAny],
  resultLowerFns: [_lowerFlatBool],
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: 0,
  stringEncoding: 'utf8',
  getMemoryFn: () => memory0,
  getReallocFn: () => null,
  importFn: _trampoline3,
},
);
let trampoline4 = _trampoline4.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 4,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline4.manuallyAsync,
  paramLiftFns: [],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatRecord([['identityType', _lowerFlatStringAny, 24, 4 ],['storageTier', _lowerFlatStringAny, 24, 4 ],['identifier', _lowerFlatStringAny, 24, 4 ],]), 28, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'not-permitted', _lowerFlatStringAny, 12, 4, 4 ],[ 'not-found', _lowerFlatStringAny, 12, 4, 4 ],[ 'invalid-schema', _lowerFlatStringAny, 12, 4, 4 ],[ 'internal', _lowerFlatStringAny, 12, 4, 4 ],]), 28, 4, 4 ],
  ])
  ],
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: 0,
  stringEncoding: 'utf8',
  getMemoryFn: () => memory0,
  getReallocFn: () => realloc0,
  importFn: _trampoline4,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 4,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline4.manuallyAsync,
  paramLiftFns: [],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatRecord([['identityType', _lowerFlatStringAny, 24, 4 ],['storageTier', _lowerFlatStringAny, 24, 4 ],['identifier', _lowerFlatStringAny, 24, 4 ],]), 28, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'not-permitted', _lowerFlatStringAny, 12, 4, 4 ],[ 'not-found', _lowerFlatStringAny, 12, 4, 4 ],[ 'invalid-schema', _lowerFlatStringAny, 12, 4, 4 ],[ 'internal', _lowerFlatStringAny, 12, 4, 4 ],]), 28, 4, 4 ],
  ])
  ],
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: 0,
  stringEncoding: 'utf8',
  getMemoryFn: () => memory0,
  getReallocFn: () => realloc0,
  importFn: _trampoline4,
},
);
let trampoline5 = _trampoline5.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 5,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline5.manuallyAsync,
  paramLiftFns: [_liftFlatStringAny],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatStringAny, 16, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'not-permitted', _lowerFlatStringAny, 12, 4, 4 ],[ 'not-found', _lowerFlatStringAny, 12, 4, 4 ],[ 'invalid-schema', _lowerFlatStringAny, 12, 4, 4 ],[ 'internal', _lowerFlatStringAny, 12, 4, 4 ],]), 16, 4, 4 ],
  ])
  ],
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: 0,
  stringEncoding: 'utf8',
  getMemoryFn: () => memory0,
  getReallocFn: () => realloc0,
  importFn: _trampoline5,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 5,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline5.manuallyAsync,
  paramLiftFns: [_liftFlatStringAny],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatStringAny, 16, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'not-permitted', _lowerFlatStringAny, 12, 4, 4 ],[ 'not-found', _lowerFlatStringAny, 12, 4, 4 ],[ 'invalid-schema', _lowerFlatStringAny, 12, 4, 4 ],[ 'internal', _lowerFlatStringAny, 12, 4, 4 ],]), 16, 4, 4 ],
  ])
  ],
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: 0,
  stringEncoding: 'utf8',
  getMemoryFn: () => memory0,
  getReallocFn: () => realloc0,
  importFn: _trampoline5,
},
);
let trampoline6 = _trampoline6.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 6,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline6.manuallyAsync,
  paramLiftFns: [_liftFlatStringAny,_liftFlatStringAny,_liftFlatStringAny],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatStringAny, 16, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'not-permitted', _lowerFlatStringAny, 12, 4, 4 ],[ 'not-found', _lowerFlatStringAny, 12, 4, 4 ],[ 'invalid-schema', _lowerFlatStringAny, 12, 4, 4 ],[ 'internal', _lowerFlatStringAny, 12, 4, 4 ],]), 16, 4, 4 ],
  ])
  ],
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: 0,
  stringEncoding: 'utf8',
  getMemoryFn: () => memory0,
  getReallocFn: () => realloc0,
  importFn: _trampoline6,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 6,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline6.manuallyAsync,
  paramLiftFns: [_liftFlatStringAny,_liftFlatStringAny,_liftFlatStringAny],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatStringAny, 16, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'not-permitted', _lowerFlatStringAny, 12, 4, 4 ],[ 'not-found', _lowerFlatStringAny, 12, 4, 4 ],[ 'invalid-schema', _lowerFlatStringAny, 12, 4, 4 ],[ 'internal', _lowerFlatStringAny, 12, 4, 4 ],]), 16, 4, 4 ],
  ])
  ],
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: 0,
  stringEncoding: 'utf8',
  getMemoryFn: () => memory0,
  getReallocFn: () => realloc0,
  importFn: _trampoline6,
},
);
let trampoline7 = _trampoline7.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 7,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline7.manuallyAsync,
  paramLiftFns: [_liftFlatStringAny,_liftFlatOption([
  ['none', null, 12, 4, 4 ],
  ['some', _liftFlatStringAny, 12, 4, 4 ],
  ])],
  resultLowerFns: [],
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: 0,
  stringEncoding: 'utf8',
  getMemoryFn: () => memory0,
  getReallocFn: () => null,
  importFn: _trampoline7,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 7,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline7.manuallyAsync,
  paramLiftFns: [_liftFlatStringAny,_liftFlatOption([
  ['none', null, 12, 4, 4 ],
  ['some', _liftFlatStringAny, 12, 4, 4 ],
  ])],
  resultLowerFns: [],
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: 0,
  stringEncoding: 'utf8',
  getMemoryFn: () => memory0,
  getReallocFn: () => null,
  importFn: _trampoline7,
},
);
Promise.all([module0, module1, module2]).catch(() => {});
({ exports: exports0 } = yield instantiateCore(yield module1));
({ exports: exports1 } = yield instantiateCore(yield module0, {
  'refarm:plugin/tractor-bridge@0.1.0': {
    'call-plugin': exports0['6'],
    'emit-telemetry': exports0['7'],
    'get-identity': exports0['4'],
    'get-node': exports0['1'],
    'get-plugin-api': exports0['5'],
    'query-nodes': exports0['2'],
    'request-permission': exports0['3'],
    'store-node': exports0['0'],
  },
}));
memory0 = exports1.memory;
realloc0 = exports1.cabi_realloc;

try {
  realloc0Async = WebAssembly.promising(exports1.cabi_realloc);
} catch(err) {
  realloc0Async = exports1.cabi_realloc;
}

({ exports: exports2 } = yield instantiateCore(yield module2, {
  '': {
    $imports: exports0.$imports,
    '0': trampoline0,
    '1': trampoline1,
    '2': trampoline2,
    '3': trampoline3,
    '4': trampoline4,
    '5': trampoline5,
    '6': trampoline6,
    '7': trampoline7,
  },
}));
postReturn0 = exports1['cabi_post_refarm:plugin/integration@0.1.0#setup'];

try {
  postReturn0Async = WebAssembly.promising(exports1['cabi_post_refarm:plugin/integration@0.1.0#setup']);
} catch(err) {
  postReturn0Async = exports1['cabi_post_refarm:plugin/integration@0.1.0#setup'];
}

postReturn1 = exports1['cabi_post_refarm:plugin/integration@0.1.0#ingest'];

try {
  postReturn1Async = WebAssembly.promising(exports1['cabi_post_refarm:plugin/integration@0.1.0#ingest']);
} catch(err) {
  postReturn1Async = exports1['cabi_post_refarm:plugin/integration@0.1.0#ingest'];
}

postReturn2 = exports1['cabi_post_refarm:plugin/integration@0.1.0#push'];

try {
  postReturn2Async = WebAssembly.promising(exports1['cabi_post_refarm:plugin/integration@0.1.0#push']);
} catch(err) {
  postReturn2Async = exports1['cabi_post_refarm:plugin/integration@0.1.0#push'];
}

postReturn3 = exports1['cabi_post_refarm:plugin/integration@0.1.0#teardown'];

try {
  postReturn3Async = WebAssembly.promising(exports1['cabi_post_refarm:plugin/integration@0.1.0#teardown']);
} catch(err) {
  postReturn3Async = exports1['cabi_post_refarm:plugin/integration@0.1.0#teardown'];
}

postReturn4 = exports1['cabi_post_refarm:plugin/integration@0.1.0#get-help-nodes'];

try {
  postReturn4Async = WebAssembly.promising(exports1['cabi_post_refarm:plugin/integration@0.1.0#get-help-nodes']);
} catch(err) {
  postReturn4Async = exports1['cabi_post_refarm:plugin/integration@0.1.0#get-help-nodes'];
}

postReturn5 = exports1['cabi_post_refarm:plugin/integration@0.1.0#metadata'];

try {
  postReturn5Async = WebAssembly.promising(exports1['cabi_post_refarm:plugin/integration@0.1.0#metadata']);
} catch(err) {
  postReturn5Async = exports1['cabi_post_refarm:plugin/integration@0.1.0#metadata'];
}

postReturn6 = exports1['cabi_post_refarm:plugin/integration@0.1.0#on-event'];

try {
  postReturn6Async = WebAssembly.promising(exports1['cabi_post_refarm:plugin/integration@0.1.0#on-event']);
} catch(err) {
  postReturn6Async = exports1['cabi_post_refarm:plugin/integration@0.1.0#on-event'];
}

postReturn7 = exports1['cabi_post_refarm:plugin/integration@0.1.0#respond'];

try {
  postReturn7Async = WebAssembly.promising(exports1['cabi_post_refarm:plugin/integration@0.1.0#respond']);
} catch(err) {
  postReturn7Async = exports1['cabi_post_refarm:plugin/integration@0.1.0#respond'];
}

integration010Setup = exports1['refarm:plugin/integration@0.1.0#setup'];
integration010Ingest = exports1['refarm:plugin/integration@0.1.0#ingest'];
integration010Push = exports1['refarm:plugin/integration@0.1.0#push'];
integration010Teardown = exports1['refarm:plugin/integration@0.1.0#teardown'];
integration010GetHelpNodes = exports1['refarm:plugin/integration@0.1.0#get-help-nodes'];
integration010Metadata = exports1['refarm:plugin/integration@0.1.0#metadata'];
integration010OnEvent = exports1['refarm:plugin/integration@0.1.0#on-event'];
integration010Respond = exports1['refarm:plugin/integration@0.1.0#respond'];
const integration010 = {
  getHelpNodes: getHelpNodes,
  ingest: ingest,
  metadata: metadata,
  onEvent: onEvent,
  push: push,
  respond: respond,
  setup: setup,
  teardown: teardown,
  
};

return { integration: integration010, 'refarm:plugin/integration@0.1.0': integration010,  };
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
};
