// 负控夹具：只允许被 erasableSyntaxOnly 的守卫拒绝（TS1294）。
// 它不在根 tsconfig 的 include 内；只有 tests/contract/runtime-support.test.js
// 用同目录 tsconfig.json 单独立项编译它，证明「非可擦除语法在运行前被抓住」有牙。
export enum ProbeEnum {
  A,
}

export namespace ProbeNamespace {
  export const value = 1;
}

export class ProbeClass {
  constructor(private readonly label: string) {}

  describe(): string {
    return this.label;
  }
}
