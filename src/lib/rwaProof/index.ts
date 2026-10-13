// RWA / institutional verification layer — Phase 1 public surface. See claudeRWA.md.
export type {
  ProofClaim,
  AnchorReceipt,
  SignedManifest,
  ScopedProof,
  VerifyResult,
} from './types';
export { type Anchor, LocalAnchor } from './anchor';
export { OpenTimestampsAnchor } from './anchorOpenTimestamps';
export {
  buildScopedProof,
  verifyScopedProof,
  recordSetRoot,
  proveRecordInclusion,
  verifyRecordInclusion,
  manifestDigest,
  type BuildOpts,
  type VerifyOpts,
} from './proof';
