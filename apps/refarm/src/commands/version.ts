import {
	__resetRefarmRuntimeMetadataCacheForTests,
	resolveRefarmVersion,
} from "./runtime-metadata.js";

export { resolveRefarmVersion };

export function __resetRefarmVersionCacheForTests(): void {
	__resetRefarmRuntimeMetadataCacheForTests();
}
