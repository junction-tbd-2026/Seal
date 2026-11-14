export type Row = { n: number | null; kind: "add" | "del" | "ctx" | "gap"; text: string };

export type FileDiff = { path: string; status: string; added: number; removed: number; rows: Row[] };

export type Result = "caught" | "missed" | "left_alone" | "false_alarm" | "failed" | "inconclusive";

export type PlantKind = "bug" | "omission" | "harmless" | "historical";

export type Plant = {
  id: string;
  kind: PlantKind;
  difficulty: string;
  description: string;
  file: string;
  line_start: number;
  line_end: number;
  breaks?: string | null;
  patch: FileDiff[];
};

export type Finding = { file: string; line_start: number; line_end: number; message: string; severity: string };

export type PointStatus = "met" | "not_met" | "cannot_tell";

export type EvidenceRef = { file: string; line_start: number; line_end: number; in_change?: boolean };

/** One requirement point as one reviewer sees it, and whether it noticed when we broke that point. */
export type PointView = {
  id: string;
  text: string;
  status: PointStatus;
  evidence: EvidenceRef[];
  reason: string;
  broken_total: number;
  broken_noticed: number;
  /** "unstable": the reviewer answered differently on two identical reviews, so the point is not scored. */
  noticed: "yes" | "no" | "partly" | "untested" | "unstable";
  /** Planted edits aimed at this point that fell outside the lines the reviewer cited. Not counted here. */
  aimed_elsewhere?: number;
  /** Citations thrown out because the lines are not in the change. */
  dropped_evidence?: number;
  /** Of those, citations that covered too many lines to count. */
  broad_evidence?: number;
  /** Every line it cites is in a test file, and the tests were not run. */
  tests_only?: boolean;
  missed_plants: string[];
};

export type Reviewer = {
  name: string;
  points: PointView[];
  run_file: string;
  created_at: string;
  verdict: boolean | null;
  review_failed: boolean;
  findings: Finding[];
  refused_to_decide: string[];
  results: Record<string, Result>;
  said: Record<string, string>;
  counts: {
    defects_total: number;
    defects_caught: number;
    harmless_total: number;
    false_alarms: number;
    failed: number;
    inconclusive: number;
  };
  claim: string;
  requirement_flip_changed_verdict: boolean | null;
  read_yourself: string[];
  tokens_in: number;
  tokens_out: number;
  seconds: number;
  reviews: number;
  notes: string[];
};

export type SpotVerdict = "right" | "wrong";

export type SignOff = {
  change_id: string;
  reviewer: string;
  name: string;
  decision: string;
  signed_at: string;
  spots?: { plant_id: string; verdict: SpotVerdict }[];
};

export type Exam = {
  change: {
    id: string;
    requirement_id: string;
    requirement_title: string;
    requirement_text: string;
    files: FileDiff[];
  };
  planter: string;
  session?: string;
  requirement_points: { id: string; text: string }[];
  created_at: string;
  build_checked: boolean;
  altered_requirement: string;
  plants: Plant[];
  reviewers: Reviewer[];
  signoffs: SignOff[];
};

export type ChangeSummary = {
  id: string;
  requirement_id: string;
  title: string;
  latest_run: string;
  reviewers: string[];
};

export type PullStatus = "untested" | "needs_you" | "clear" | "signed";

export type Pull = {
  number: number;
  change_id: string;
  requirement_id: string;
  title: string;
  author: string;
  files: number;
  url: string;
  status: PullStatus;
  lines_to_read: number;
  reviewers: string[];
  caught?: number;
  planted_defects?: number;
  signed: SignOff | null;
};

export type SpotRecord = { enabled: boolean; rate?: number; checked: number; caught: number };

export type PullList = {
  repository: string;
  repository_url: string;
  base_branch: string;
  pull_requests: Pull[];
  spot_checks: SpotRecord;
};

/** What signing returns: either a recorded sign-off, or the reveal that the copy shown was a spot-check. */
export type SignResult =
  | { spot_check: false; signoff: SignOff }
  | { spot_check: true; caught: boolean; spotted: boolean; seconds: number; plant: Plant; record: SpotRecord };
