/** 能力 key 表与四态求交的浏览器安全出口：capabilities 的纯值叶子经 controller 传给 client，展示层只从 client 取，不直接依赖 capabilities。 */
export { CapabilityKey, intersectAccess } from '@harness-projects/capabilities/keys'
