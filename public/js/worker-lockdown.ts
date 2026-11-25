// The pattern worker's first module (SPEC "Sandbox protocol"): it runs at the app's origin, so before any pattern code
// it deletes what reaches the origin's storage, the network or other contexts from the worker's global and navigator,
// prototypes included, where no reference to them survives. The worker's CSP blocks fetches and script loads besides.

const GLOBALS = [
  'indexedDB', 'caches', 'webkitRequestFileSystem', 'webkitRequestFileSystemSync', 'webkitResolveLocalFileSystemURL',
  'webkitResolveLocalFileSystemSyncURL', 'fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'WebTransport',
  'EventSource', 'BroadcastChannel', 'Worker', 'SharedWorker', 'importScripts',
];
const NAVIGATOR = ['storage', 'storageBuckets', 'locks', 'serviceWorker', 'sendBeacon'];

/** Deletes each name wherever `obj` or its prototypes hold it. */
function strip(obj: object | null | undefined, names: readonly string[]) {
  for (let o = obj; o; o = Object.getPrototypeOf(o)) {
    for (const name of names) if (Object.hasOwn(o, name)) Reflect.deleteProperty(o, name);
  }
}

const scope = globalThis as unknown as { navigator?: object };
strip(scope.navigator, NAVIGATOR);
strip(globalThis, GLOBALS);
