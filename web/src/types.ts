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
  patch: FileDiff[];
};

export type Finding = { file: string; line_start: number; line_end: number; message: string; severity: string };

export type Reviewer = {
  name: string;
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

export type SignOff = { change_id: string; reviewer: string; name: string; decision: string; signed_at: string };

export type Exam = {
  change: {
    id: string;
    requirement_id: string;
    requirement_title: string;
    requirement_text: string;
    files: FileDiff[];
  };
  planter: string;
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
