const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { createInference } = require('../src/inference.cjs');

test('voice loading accepts versioned and legacy language files and rejects unknown voices', async t => {
  const opened = [];
  const load = Module._load;
  t.mock.method(Module, '_load', function (name, ...args) {
    if (name !== 'onnxruntime-node') return load.call(this, name, ...args);
    return { InferenceSession: { create: async file => {
      opened.push(file);
      return {outputNames: ['waveform'], release: async () => {}};
    } } };
  });
  const inference = createInference({resolve: uri => uri}, () => {});
  t.after(() => inference.close());
  for (const name of ['en.onnx', 'tl.onnx', 'voice-en-b9b22875c9833bf4.onnx', 'voice-tl-28d68857286c77cf.onnx']) {
    const file = '/documents/voices/' + name;
    assert.deepEqual(await inference.handlers['voice.open'](file), {id: file, outputNames: ['waveform']});
    await inference.handlers['voice.open'](file);
  }
  assert.equal(opened.length, 4, 'each cached voice opens once');
  for (const name of ['voice-bis-b9b22875c9833bf4.onnx', 'voice-tl-latest.onnx', 'model.onnx', 'en.onnx.exe']) {
    await assert.rejects(inference.handlers['voice.open']('/documents/voices/' + name), /Unknown voice/);
  }
  assert.equal(opened.length, 4);
});
