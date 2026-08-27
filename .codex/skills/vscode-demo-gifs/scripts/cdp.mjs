import { isAbsolute, relative, resolve, sep } from 'node:path';

const [webSocketUrl, mode, ...rest] = process.argv.slice(2);
const scratchRootInput = process.env.MDEPUB_DEMO_ROOT;

if (!webSocketUrl || !mode) {
  throw new Error('Usage: MDEPUB_DEMO_ROOT=/tmp/recording bun cdp.mjs <webSocketUrl> <eval|eval-context|insert-file|screenshot|input> <argument>');
}
if (!scratchRootInput) {
  throw new Error('MDEPUB_DEMO_ROOT is required and must be the temporary recording directory.');
}

const scratchRoot = resolve(scratchRootInput);
const temporaryRoot = resolve('/tmp');
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const allowedInputMethods = new Set([
  'Input.dispatchKeyEvent',
  'Input.dispatchMouseEvent',
  'Input.insertText',
]);

const scratchRelation = relative(temporaryRoot, scratchRoot);
if (!scratchRelation || scratchRelation === '..' || scratchRelation.startsWith(`..${sep}`) || isAbsolute(scratchRelation)) {
  throw new Error('MDEPUB_DEMO_ROOT must be a dedicated directory below /tmp.');
}

function requireLoopbackEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('The CDP endpoint must be a valid WebSocket URL.');
  }
  if (endpoint.protocol !== 'ws:' || !loopbackHosts.has(endpoint.hostname) || !endpoint.port) {
    throw new Error('CDP is restricted to a ported ws:// loopback endpoint owned by the isolated workbench.');
  }
  if (endpoint.username || endpoint.password) {
    throw new Error('CDP endpoints must not include credentials.');
  }
  return endpoint.href;
}

function requireScratchPath(value, label) {
  if (!value) throw new Error(`${label} is required.`);
  const resolved = resolve(value);
  const relation = relative(scratchRoot, resolved);
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`${label} must be a file inside MDEPUB_DEMO_ROOT.`);
  }
  return resolved;
}

const endpoint = requireLoopbackEndpoint(webSocketUrl);
const id = 1;
let request;
let outputPath;
if (mode === 'eval') {
  request = {
    id,
    method: 'Runtime.evaluate',
    params: {
      expression: rest.join(' '),
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    },
  };
} else if (mode === 'eval-context') {
  const contextId = Number(rest[0]);
  if (!Number.isInteger(contextId)) throw new Error('An execution context id is required.');
  request = {
    id,
    method: 'Runtime.evaluate',
    params: {
      expression: rest.slice(1).join(' '),
      contextId,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    },
  };
} else if (mode === 'insert-file') {
  const sourcePath = requireScratchPath(rest[0], 'The source file path');
  request = {
    id,
    method: 'Input.insertText',
    params: { text: await Bun.file(sourcePath).text() },
  };
} else if (mode === 'screenshot') {
  outputPath = requireScratchPath(rest[0], 'The screenshot output path');
  request = {
    id,
    method: 'Page.captureScreenshot',
    params: { format: 'png', fromSurface: true },
  };
} else if (mode === 'input') {
  const [method, paramsJson = '{}'] = rest;
  if (!allowedInputMethods.has(method)) {
    throw new Error(`Only isolated input methods are allowed: ${[...allowedInputMethods].join(', ')}.`);
  }
  request = { id, method, params: JSON.parse(paramsJson) };
} else {
  throw new Error(`Unknown mode: ${mode}`);
}

const response = await new Promise((resolveResponse, reject) => {
  const socket = new WebSocket(endpoint);
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error('Timed out waiting for the Chrome DevTools response.'));
  }, 15_000);
  socket.addEventListener('open', () => socket.send(JSON.stringify(request)));
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== id) return;
    clearTimeout(timer);
    socket.close();
    resolveResponse(message);
  });
  socket.addEventListener('error', () => {
    clearTimeout(timer);
    reject(new Error('Could not connect to the loopback CDP endpoint.'));
  });
});

if (outputPath) {
  if (response.error) throw new Error(JSON.stringify(response.error));
  await Bun.write(outputPath, Buffer.from(response.result.data, 'base64'));
  console.log(JSON.stringify({ id, saved: outputPath }));
} else {
  console.log(JSON.stringify(response));
}
