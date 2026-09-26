export type PhotoIssue =
  | 'too_dark'
  | 'too_close'
  | 'lid_closed'
  | 'blocked'
  | 'not_the_equipment'
  | 'blurry';

export type CheckId = 'amps' | 'place' | 'room' | 'photos';
export type CheckStatus = 'pass' | 'fail' | 'unsure';
export type Outcome = 'yes' | 'unsure' | 'no' | 'retake';
export type YesNoUnsure = 'yes' | 'no' | 'unsure';
export type PanelLocation = 'outside' | 'garage' | 'closet' | 'other' | 'unsure';

export type Check = {
  id: CheckId;
  question: string;
  status: CheckStatus;
  answer: string;
};

export type HomeScore = {
  outcome: Outcome;
  batteries: 0 | 1 | 2 | null;
  headline: string;
  reason: string;
  checks: Check[];
};

export type Sighting = {
  photoIssues: PhotoIssue[];
  photoNote: string;
  amps: number | null;
  ampsClear: boolean;
  ampsNote: string;
  sameWall: YesNoUnsure;
  location: PanelLocation;
  meterTooHigh: YesNoUnsure;
  placeNote: string;
  room: YesNoUnsure;
  roomNote: string;
  solar: YesNoUnsure;
};

export const QUESTIONS: { id: CheckId; question: string; detail: string }[] = [
  {
    id: 'amps',
    question: 'Is the wiring strong enough?',
    detail:
      "There's a number on the main switch, like 150 or 200. Too small means no battery, or only one.",
  },
  {
    id: 'place',
    question: 'Is the wiring set up in the right place?',
    detail:
      "The meter and the breaker box need to be on the same wall, outside or in the garage, not in a closet, and the meter can't be mounted too high.",
  },
  {
    id: 'room',
    question: 'Is there room for the box?',
    detail:
      'Next to the meter there needs to be a patch of ground about the size of an AC unit, with space around it. Nothing in the way: no gas meter, window, fence, or junk pile too close.',
  },
  {
    id: 'photos',
    question: 'Are the photos good enough to judge?',
    detail:
      'Too dark, too close, the lid closed, or something blocking the view means the customer has to retake it.',
  },
];

const QUESTION_TEXT = Object.fromEntries(QUESTIONS.map((item) => [item.id, item.question])) as Record<
  CheckId,
  string
>;

const ISSUE_LABEL: Record<PhotoIssue, string> = {
  too_dark: "It's too dark.",
  too_close: "It's too close to tell what you're looking at.",
  lid_closed: 'The lid is closed, so the main switch is hidden.',
  blocked: 'Something is blocking the view.',
  not_the_equipment: "This doesn't show the meter or the breaker box.",
  blurry: "It's too blurry to judge.",
};

const BRANCH_BREAKERS = new Set([15, 20, 25, 30, 40, 50]);
const MAIN_RATINGS = new Set([100, 110, 125, 150, 175, 200, 225]);

const ISSUE_ALIASES: Record<string, PhotoIssue> = {
  too_dark: 'too_dark',
  dark: 'too_dark',
  too_close: 'too_close',
  close: 'too_close',
  lid_closed: 'lid_closed',
  closed: 'lid_closed',
  lid: 'lid_closed',
  blocked: 'blocked',
  obstructed: 'blocked',
  not_the_equipment: 'not_the_equipment',
  not_electrical: 'not_the_equipment',
  blurry: 'blurry',
  blur: 'blurry',
};

export function sightingFromModel(text: string): Sighting {
  const parsed = asRecord(firstJsonObject(text));
  const notes = asRecord(parsed.notes);
  let photoIssues = readIssues(parsed.photo_issues);
  let amps = readAmps(parsed.amps);
  const clearFlag = asBool(parsed.amps_clear);
  let ampsClear = clearFlag === null ? amps !== null : clearFlag;

  if (photoIssues.includes('lid_closed')) {
    ampsClear = false;
  } else if (ampsClear && amps !== null && MAIN_RATINGS.has(amps)) {
    photoIssues = photoIssues.filter((issue) => issue === 'lid_closed');
  }

  if (asBool(parsed.usable) === false && photoIssues.length === 0 && !ampsClear) {
    photoIssues = ['not_the_equipment'];
  }

  return {
    photoIssues,
    photoNote: note(notes.photos),
    amps,
    ampsClear,
    ampsNote: note(notes.amps),
    sameWall: tri(parsed.same_wall),
    location: readLocation(parsed.location),
    meterTooHigh: tri(parsed.meter_too_high),
    placeNote: note(notes.place),
    room: tri(parsed.room),
    roomNote: note(notes.room),
    solar: tri(parsed.solar),
  };
}

export function decide(sighting: Sighting): HomeScore {
  const photos = photoCheck(sighting);
  const amps = ampsCheck(sighting);
  const place = placeCheck(sighting);
  const room = roomCheck(sighting);
  const checks = [amps.check, place.check, room.check, photos.check];

  if (photos.check.status === 'fail') {
    const waiting = 'This waits until the photo is good enough to judge.';
    return {
      outcome: 'retake',
      batteries: null,
      headline: 'Retake the photos',
      reason: photos.check.answer,
      checks: checks.map((check) =>
        check.id === 'photos' || check.id === 'amps' ? check : { ...check, status: 'unsure', answer: waiting },
      ),
    };
  }

  const failures = checks.filter((check) => check.status === 'fail');
  if (failures.length > 0) {
    return {
      outcome: 'no',
      batteries: 0,
      headline: 'No',
      reason: failures.map((check) => check.answer).join(' '),
      checks,
    };
  }

  const unsure = checks.filter((check) => check.status === 'unsure');
  if (unsure.length > 0) {
    const lead = amps.check.status === 'pass' ? `${amps.check.answer} ` : '';
    return {
      outcome: 'unsure',
      batteries: amps.batteries,
      headline: 'Not sure — send to a person',
      reason: `${lead}${unsure.map((check) => check.answer).join(' ')}`.trim(),
      checks,
    };
  }

  const batteries = amps.batteries === 1 || amps.batteries === 2 ? amps.batteries : 1;
  const noun = batteries === 1 ? 'battery' : 'batteries';
  return {
    outcome: 'yes',
    batteries,
    headline: `Yes — fits ${batteries} ${noun}`,
    reason:
      'The wiring can take it, the gear is in the right place, there is room beside the meter, and the photos are clear enough.',
    checks,
  };
}

function photoCheck(sighting: Sighting): { check: Check } {
  if (sighting.photoIssues.length === 0) {
    return {
      check: {
        id: 'photos',
        question: QUESTION_TEXT.photos,
        status: 'pass',
        answer: sighting.photoNote || 'The photos are clear enough to judge.',
      },
    };
  }
  const reasons = sighting.photoIssues.map((issue) => ISSUE_LABEL[issue]).join(' ');
  return {
    check: {
      id: 'photos',
      question: QUESTION_TEXT.photos,
      status: 'fail',
      answer: `${reasons} The customer has to retake it.`,
    },
  };
}

function ampsCheck(sighting: Sighting): { check: Check; batteries: 0 | 1 | 2 | null } {
  const base = { id: 'amps' as const, question: QUESTION_TEXT.amps };
  if (!sighting.ampsClear || sighting.amps === null) {
    return {
      batteries: null,
      check: {
        ...base,
        status: 'unsure',
        answer: sighting.ampsNote || "Couldn't read the number on the main switch.",
      },
    };
  }

  const value = sighting.amps;
  if (BRANCH_BREAKERS.has(value)) {
    return {
      batteries: null,
      check: {
        ...base,
        status: 'unsure',
        answer: `The only clear number is ${value}, and that is a branch breaker, not the main switch.`,
      },
    };
  }
  if (value < 100) {
    return {
      batteries: 0,
      check: {
        ...base,
        status: 'fail',
        answer: `The main switch is ${value} amps. That's under 100, so a battery won't go on this house.`,
      },
    };
  }
  if (value > 225) {
    return {
      batteries: null,
      check: {
        ...base,
        status: 'unsure',
        answer: `The main switch reads ${value} amps, which is outside the 100 to 200 amp range Base installs on. A person should look.`,
      },
    };
  }
  if (sighting.solar === 'yes' && value < 200) {
    return {
      batteries: 0,
      check: {
        ...base,
        status: 'fail',
        answer: `The main switch is ${value} amps, and the house has solar. Solar needs a 200 amp main switch.`,
      },
    };
  }
  if (value >= 200) {
    return {
      batteries: 2,
      check: {
        ...base,
        status: 'pass',
        answer: `The main switch says ${value}. That fits two batteries.`,
      },
    };
  }
  return {
    batteries: 1,
    check: {
      ...base,
      status: 'pass',
      answer: `The main switch says ${value}. That fits one battery.`,
    },
  };
}

function placeCheck(sighting: Sighting): { check: Check } {
  const fails: string[] = [];
  if (sighting.location === 'closet') {
    fails.push('The breaker box is in a closet.');
  }
  if (sighting.sameWall === 'no') {
    fails.push('The meter and the breaker box are not on the same wall.');
  }
  if (sighting.meterTooHigh === 'yes') {
    fails.push('The meter is mounted too high. It has to be within 6 feet of the ground.');
  }
  if (fails.length > 0) {
    return {
      check: {
        id: 'place',
        question: QUESTION_TEXT.place,
        status: 'fail',
        answer: fails.join(' '),
      },
    };
  }

  const placed =
    (sighting.location === 'outside' || sighting.location === 'garage') &&
    sighting.sameWall === 'yes' &&
    sighting.meterTooHigh === 'no';
  if (placed) {
    return {
      check: {
        id: 'place',
        question: QUESTION_TEXT.place,
        status: 'pass',
        answer:
          'The meter and the breaker box are on the same wall, outside or in the garage, and the meter is not too high.',
      },
    };
  }

  const extra =
    sighting.location === 'other'
      ? "The breaker box doesn't look like it's outside or in the garage."
      : '';
  return {
    check: {
      id: 'place',
      question: QUESTION_TEXT.place,
      status: 'unsure',
      answer:
        [extra, sighting.placeNote].filter(Boolean).join(' ') ||
        'A person still needs to check that the meter and breaker box share a wall, sit outside or in the garage, and the meter is not above 6 feet.',
    },
  };
}

function roomCheck(sighting: Sighting): { check: Check } {
  if (sighting.room === 'no') {
    return {
      check: {
        id: 'room',
        question: QUESTION_TEXT.room,
        status: 'fail',
        answer:
          sighting.roomNote ||
          'There is not a clear patch of ground beside the meter. A gas meter, window, fence, or junk pile is in the way.',
      },
    };
  }
  if (sighting.room === 'yes') {
    return {
      check: {
        id: 'room',
        question: QUESTION_TEXT.room,
        status: 'pass',
        answer:
          sighting.roomNote ||
          'There is a clear patch of ground beside the meter, about the size of an AC unit, with space around it.',
      },
    };
  }
  return {
    check: {
      id: 'room',
      question: QUESTION_TEXT.room,
      status: 'unsure',
      answer: sighting.roomNote || 'A person still needs to check the ground beside the meter.',
    },
  };
}

function firstJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new Error("The photo checker didn't return a score.");
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1)) as unknown;
    }
  }
  throw new Error("The photo checker didn't return a score.");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readIssues(value: unknown): PhotoIssue[] {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const issues: PhotoIssue[] = [];
  for (const item of source) {
    const key = String(item).trim().toLowerCase().replaceAll(' ', '_');
    const issue = ISSUE_ALIASES[key];
    if (issue && !issues.includes(issue)) issues.push(issue);
  }
  return issues;
}

function readAmps(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string') {
    const match = value.match(/\d{2,3}/);
    if (!match) return null;
    return Number(match[0]);
  }
  return null;
}

function readLocation(value: unknown): PanelLocation {
  const text = String(value ?? '').toLowerCase();
  if (text.includes('closet')) return 'closet';
  if (text.includes('garage')) return 'garage';
  if (text.includes('out')) return 'outside';
  if (text.includes('other') || text.includes('indoor') || text.includes('inside')) return 'other';
  return 'unsure';
}

function tri(value: unknown): YesNoUnsure {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'yes' || text === 'true' || text === 'y') return 'yes';
  if (text === 'no' || text === 'false' || text === 'n') return 'no';
  return 'unsure';
}

function asBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true' || text === 'yes') return true;
    if (text === 'false' || text === 'no') return false;
  }
  return null;
}

function note(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, 240);
}
