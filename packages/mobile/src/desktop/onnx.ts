import { desktop } from './bridge';
export class Tensor {
  constructor(readonly type: string, readonly data: BigInt64Array | Float32Array, readonly dims: readonly number[]) {}
}
export class InferenceSession {
  constructor(readonly id: string, readonly outputNames: string[]) {}
  static async create(uri: string, _options?: unknown) {
    const { id, outputNames } = await desktop().invoke('voice.open', uri);
    return new InferenceSession(id, outputNames);
  }
  async run(values: Record<string, Tensor>): Promise<Record<string, { data: Float32Array }>> {
    const serialized = Object.fromEntries(Object.entries(values).map(([name, tensor]) => [name,
      { type: tensor.type, dims: [...tensor.dims], data: Array.from(tensor.data as BigInt64Array, String) }]));
    return desktop().invoke('voice.run', this.id, serialized);
  }
}
