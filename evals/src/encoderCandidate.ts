/** Candidate only. No score is emitted until a checkpoint and calibration are pinned. */
export const ENCODER_CANDIDATE = {
  id: "solenoid-encoder-candidate-v1",
  status: "training_required",
  // TODO: choose an open-weight checkpoint or train on disjoint source/cluster splits.
  // Pin weights, tokenizer, label mapping, preprocessing, and calibration before a runnable EngineSpec is added.
  requiredArtifacts: ["weights_sha256", "tokenizer_sha256", "label_map", "preprocessing_version", "calibration_set", "threshold_rule"],
} as const;

export function inferEncoderCandidate(): never {
  throw new Error("Encoder candidate has no pinned checkpoint; train or select and validate one before inference");
}
