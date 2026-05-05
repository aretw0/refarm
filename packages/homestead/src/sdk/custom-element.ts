export interface HomesteadReactiveElementController {
	dispose(): void;
}

export interface HomesteadReactiveElement<
	TOptions = unknown,
	TController extends
		HomesteadReactiveElementController = HomesteadReactiveElementController,
> extends HTMLElement {
	connectHomesteadReactiveElement(options?: TOptions): TController;
}

export interface HomesteadReactiveElementDefinition<
	TOptions,
	TController extends HomesteadReactiveElementController,
> {
	name: string;
	registry?: CustomElementRegistry;
	connect(element: HTMLElement, options: TOptions): TController;
}

export function defineHomesteadReactiveElement<
	TOptions = undefined,
	TController extends
		HomesteadReactiveElementController = HomesteadReactiveElementController,
>(definition: HomesteadReactiveElementDefinition<TOptions, TController>): void {
	const registry = definition.registry ?? globalThis.customElements;
	if (!registry || registry.get(definition.name)) return;

	class ReactiveHomesteadElement
		extends HTMLElement
		implements HomesteadReactiveElement<TOptions, TController>
	{
		#controller?: TController;

		connectHomesteadReactiveElement(options?: TOptions): TController {
			this.#controller?.dispose();
			this.#controller = definition.connect(this, options as TOptions);
			return this.#controller;
		}

		disconnectedCallback(): void {
			this.#controller?.dispose();
			this.#controller = undefined;
		}
	}

	registry.define(definition.name, ReactiveHomesteadElement);
}

export function connectHomesteadReactiveElement<
	TOptions,
	TController extends HomesteadReactiveElementController,
>(
	element: HomesteadReactiveElement<TOptions, TController>,
	options: TOptions,
): TController {
	return element.connectHomesteadReactiveElement(options);
}
