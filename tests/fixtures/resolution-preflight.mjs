// 测试首 import：只依赖内建模块的守卫先于任何工作区模块 body 求值。
import { assertLocalResolutions } from '../../scripts/resolution-check.mjs';

assertLocalResolutions();
