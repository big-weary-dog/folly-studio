// Reading the host's environment.

/** An on/off setting: 1, true, on or yes (any case) is on; anything else, or unset, is off. */
export const envFlag = (v?: string) => /^(1|true|on|yes)$/i.test(v?.trim() ?? '');
