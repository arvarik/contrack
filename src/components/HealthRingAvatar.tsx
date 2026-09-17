/**
 * HealthRingAvatar: the old name of ScoreRingAvatar.
 *
 * The ring showed the contact's colour and was called a health ring. It now
 * shows the relationship score, so the component carries that name. This
 * alias keeps an import from a branch cut before the rename working for one
 * release, and then it goes.
 *
 * @deprecated Import `ScoreRingAvatar` from `./ScoreRingAvatar`.
 */
export {
  ScoreRingAvatar as HealthRingAvatar,
  type ScoreRingAvatarProps as HealthRingAvatarProps,
} from "./ScoreRingAvatar";
