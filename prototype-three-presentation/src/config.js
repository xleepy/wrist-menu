export const PROFILES = [
  {
    key: "A",
    name: "Balanced",
    rationale: "Provisional default",
    panelWidth: 0.18,
    panelHeight: 0.142,
    viewportWidth: 0.164,
    viewportHeight: 0.096,
    rowHeight: 0.018,
    rowGap: 0.002,
    separatorHeight: 0.008,
    handThreshold: 0.008,
    controllerThreshold: 0.012,
  },
  {
    key: "B",
    name: "Reach",
    rationale: "Larger legibility contrast",
    panelWidth: 0.192,
    panelHeight: 0.158,
    viewportWidth: 0.176,
    viewportHeight: 0.108,
    rowHeight: 0.02,
    rowGap: 0.0025,
    separatorHeight: 0.009,
    handThreshold: 0.009,
    controllerThreshold: 0.013,
  },
  {
    key: "C",
    name: "Compact",
    rationale: "Smaller wrist-footprint contrast",
    panelWidth: 0.168,
    panelHeight: 0.128,
    viewportWidth: 0.152,
    viewportHeight: 0.084,
    rowHeight: 0.016,
    rowGap: 0.0018,
    separatorHeight: 0.007,
    handThreshold: 0.007,
    controllerThreshold: 0.01,
  },
];

export const POOL_CAPACITY = 12;
export const OVERSCAN_ENTRIES = 1;

export function getProfile(key) {
  return PROFILES.find((profile) => profile.key === key?.toUpperCase()) ?? PROFILES[0];
}

export function profileFromLocation(locationLike = window.location) {
  return getProfile(new URLSearchParams(locationLike.search).get("variant"));
}

export function millimetres(value) {
  return Math.round(value * 1000);
}
