import assert from "node:assert/strict";
import test from "node:test";

import {
  coreContract,
  type GitHubIssue,
  type GitHubIssueMutationResult,
  type GitHubIssueProjection,
  type GitHubIssueReadResult,
  type GitHubTrackerFailureCode,
  type GitHubTrackerPort,
  type StartWorkflowTaskRequest,
  type WorkflowEventMetadata,
  type WorkflowState,
} from "@dnslin/sayhi-core";

const GITHUB_TASK: StartWorkflowTaskRequest = {
  contractVersion: 1,
  task: {
    id: "TASK-GITHUB-32",
    title: "Project local Task state to GitHub",
    route: "build",
    parentTaskId: null,
    initiativeGraphId: null,
    intent: {
      goals: ["Keep a mapped GitHub Issue current without changing local authority."],
      nonGoals: ["Treat the GitHub Issue as the Task state authority."],
      acceptanceCriteria: ["Remote closure is recorded without completing the Task."],
    },
    scope: {
      files: ["packages/core/src/github-tracker.ts"],
      apis: ["GitHubTrackerPort"],
      schemas: ["events.jsonl", "task.json"],
      locks: [],
    },
    baselineRef: "baseline.json",
    contexts: {},
    policies: { commit: "never", push: "never", maxRepairAttempts: 2 },
  },
  routeGate: {
    gate: "route",
    evidence: [{ kind: "human-approval", reference: "evidence/route.json" }],
  },
  event: eventMetadata("CREATED", "2026-07-19T12:00:00Z"),
};

class MemoryGitHubTracker implements GitHubTrackerPort {
  issue: GitHubIssue | null = null;
  createCalls = 0;
  updateCalls = 0;
  readCalls = 0;
  failure: GitHubTrackerFailureCode | null = null;
  createOutcomeUnknownAfterWrite = false;

  async findIssueByTaskId(taskId: string): Promise<GitHubIssueReadResult> {
    if (this.failure !== null) {
      return { kind: "failure", code: this.failure };
    }
    if (
      this.issue === null ||
      !this.issue.body.includes(`<!-- sayhi-task:${encodeURIComponent(taskId)} -->`)
    ) {
      return { kind: "not-found" };
    }
    return { kind: "found", issue: this.issue };
  }

  async readIssue(reference: { readonly externalId: string }): Promise<GitHubIssueReadResult> {
    this.readCalls += 1;
    if (this.failure !== null) {
      return { kind: "failure", code: this.failure };
    }
    if (this.issue === null || this.issue.externalId !== reference.externalId) {
      return { kind: "not-found" };
    }
    return { kind: "found", issue: this.issue };
  }

  async createIssue(input: {
    readonly taskId: string;
    readonly projection: GitHubIssueProjection;
    readonly idempotencyKey: string;
  }): Promise<GitHubIssueMutationResult> {
    this.createCalls += 1;
    if (this.failure !== null) {
      return { kind: "failure", code: this.failure };
    }
    if (this.issue !== null) {
      return { kind: "success", issue: this.issue };
    }
    this.issue = {
      externalId: "42",
      uri: "https://github.com/dnslin/sayhi/issues/42",
      version: "v1",
      title: input.projection.title,
      body: input.projection.body,
      state: input.projection.state,
    };
    if (this.createOutcomeUnknownAfterWrite) {
      this.createOutcomeUnknownAfterWrite = false;
      return { kind: "failure", code: "outcome-unknown" };
    }
    return { kind: "success", issue: this.issue };
  }

  async updateIssue(input: {
    readonly reference: { readonly externalId: string; readonly observedVersion: string };
    readonly projection: GitHubIssueProjection;
    readonly idempotencyKey: string;
  }): Promise<GitHubIssueMutationResult> {
    this.updateCalls += 1;
    if (this.failure !== null) {
      return { kind: "failure", code: this.failure };
    }
    if (this.issue === null || this.issue.externalId !== input.reference.externalId) {
      return { kind: "not-found" };
    }
    if (this.issue.version !== input.reference.observedVersion) {
      return { kind: "conflict", issue: this.issue };
    }
    this.issue = {
      ...this.issue,
      version: `v${Number.parseInt(this.issue.version.slice(1), 10) + 1}`,
      title: input.projection.title,
      body: input.projection.body,
      state: input.projection.state,
    };
    return { kind: "success", issue: this.issue };
  }

  changeRemote(change: Partial<Pick<GitHubIssue, "title" | "body" | "state">>): void {
    assert.notEqual(this.issue, null);
    if (this.issue === null) {
      return;
    }
    this.issue = {
      ...this.issue,
      ...change,
      version: `v${Number.parseInt(this.issue.version.slice(1), 10) + 1}`,
    };
  }
}

function eventMetadata(suffix: string, occurredAt: string): WorkflowEventMetadata {
  return {
    eventId: `EVENT-GITHUB-32-${suffix}`,
    actor: { kind: "orchestrator", id: "sayhi-test", sessionRef: "session-32" },
    reason: `Synchronize GitHub Issue (${suffix}).`,
    idempotencyKey: `IDEMPOTENCY-GITHUB-32-${suffix}`,
    occurredAt,
  };
}

function startState(): WorkflowState {
  const created = coreContract.startWorkflowTask(GITHUB_TASK);
  assert.equal(created.ok, true);
  if (!created.ok) {
    throw new Error("Expected GitHub Tracker fixture to start.");
  }
  return created.state;
}

function advanceToExplore(state: WorkflowState): WorkflowState {
  const advanced = coreContract.transitionWorkflow(state, {
    contractVersion: 1,
    taskId: state.projection.id,
    expectedVersion: state.projection.version,
    to: { lifecycle: "active", phase: "explore", step: "ready" },
    gates: [
      {
        gate: "route",
        evidence: [{ kind: "human-approval", reference: "evidence/explore.json" }],
      },
    ],
    event: eventMetadata("EXPLORE", "2026-07-19T12:01:00Z"),
  });
  assert.equal(advanced.ok, true);
  if (!advanced.ok) {
    throw new Error("Expected GitHub Tracker transition to succeed.");
  }
  return advanced.state;
}
test("Core recovers a GitHub Issue mapping after an unknown create outcome without duplicating it", async () => {
  const tracker = new MemoryGitHubTracker();
  tracker.createOutcomeUnknownAfterWrite = true;
  const state = startState();
  const event = eventMetadata("CREATE-UNKNOWN", "2026-07-19T12:00:01Z");

  const uncertain = await coreContract.pushGitHubIssueProjection({ state, tracker, event });
  assert.equal(uncertain.disposition, "diagnostic");
  if (uncertain.disposition === "diagnostic") {
    assert.equal(uncertain.diagnostic.code, "github.outcome_unknown");
    assert.equal(uncertain.state, state);
  }
  assert.equal(tracker.createCalls, 1);

  const retried = await coreContract.pushGitHubIssueProjection({ state, tracker, event });
  assert.equal(retried.disposition, "observed");
  assert.equal(tracker.createCalls, 1);
  if (retried.disposition === "observed") {
    assert.equal(retried.state.events.at(-1)?.type, "tracker_synchronized");
  }
});



test("Core creates and conditionally updates one mapped GitHub Issue without retry duplicates", async () => {
  const tracker = new MemoryGitHubTracker();
  const created = await coreContract.pushGitHubIssueProjection({
    state: startState(),
    tracker,
    event: eventMetadata("CREATE", "2026-07-19T12:00:01Z"),
  });
  assert.equal(created.disposition, "created");
  if (created.disposition !== "created") {
    return;
  }
  assert.equal(tracker.createCalls, 1);
  assert.equal(created.state.events.at(-1)?.type, "tracker_synchronized");
  assert.deepEqual(created.state.projection.externalReferences, ["github-TASK-GITHUB-32"]);
  assert.match(tracker.issue?.body ?? "", /<!-- sayhi-task:TASK-GITHUB-32 -->/u);

  const retried = await coreContract.pushGitHubIssueProjection({
    state: created.state,
    tracker,
    event: eventMetadata("CREATE", "2026-07-19T12:00:01Z"),
  });
  assert.equal(retried.disposition, "unchanged");
  assert.equal(tracker.createCalls, 1);
  assert.equal(retried.state.events.length, created.state.events.length);

  const updated = await coreContract.pushGitHubIssueProjection({
    state: advanceToExplore(created.state),
    tracker,
    event: eventMetadata("UPDATE", "2026-07-19T12:01:01Z"),
  });
  assert.equal(updated.disposition, "updated");
  if (updated.disposition !== "updated") {
    return;
  }
  assert.equal(tracker.updateCalls, 1);
  assert.match(tracker.issue?.body ?? "", /- Phase: `explore`/u);
  assert.equal(updated.event.change, "updated");
});

test("Core reports concurrent GitHub projection edits without replacing local Task state", async () => {
  const tracker = new MemoryGitHubTracker();
  const created = await coreContract.pushGitHubIssueProjection({
    state: startState(),
    tracker,
    event: eventMetadata("CREATE", "2026-07-19T12:00:01Z"),
  });
  assert.equal(created.disposition, "created");
  if (created.disposition !== "created") {
    return;
  }
  tracker.changeRemote({ title: "Manual GitHub title" });
  const local = advanceToExplore(created.state);

  const conflict = await coreContract.pushGitHubIssueProjection({
    state: local,
    tracker,
    event: eventMetadata("UPDATE", "2026-07-19T12:01:01Z"),
  });
  assert.equal(conflict.disposition, "sync-conflict");
  if (conflict.disposition !== "sync-conflict") {
    return;
  }
  assert.equal(conflict.state, local);
  assert.equal(conflict.conflict.expectedVersion, "v1");
  assert.equal(conflict.conflict.observed.version, "v2");
  assert.equal(conflict.state.projection.phase, "explore");
  assert.equal(conflict.state.events.length, local.events.length);
  assert.equal(tracker.issue?.title, "Manual GitHub title");
});

test("Core records external GitHub closure without completing the local Task", async () => {
  const tracker = new MemoryGitHubTracker();
  const created = await coreContract.pushGitHubIssueProjection({
    state: startState(),
    tracker,
    event: eventMetadata("CREATE", "2026-07-19T12:00:01Z"),
  });
  assert.equal(created.disposition, "created");
  if (created.disposition !== "created") {
    return;
  }
  tracker.changeRemote({ state: "closed" });

  const pulled = await coreContract.pullGitHubIssueProjection({
    state: created.state,
    tracker,
    event: eventMetadata("PULL-CLOSED", "2026-07-19T12:02:00Z"),
  });
  assert.equal(pulled.disposition, "external-closed");
  if (pulled.disposition !== "external-closed") {
    return;
  }
  assert.equal(pulled.state.projection.lifecycle, "active");
  assert.equal(pulled.state.projection.phase, "triage");
  assert.equal(pulled.event.change, "external_closed");
  assert.equal(pulled.event.reference.observedVersion, "v2");
  assert.equal(pulled.state.events.length, created.state.events.length + 1);
  const repeated = await coreContract.pullGitHubIssueProjection({
    state: pulled.state,
    tracker,
    event: eventMetadata("PULL-CLOSED-RETRY", "2026-07-19T12:03:00Z"),
  });
  assert.equal(repeated.disposition, "unchanged");
  assert.equal(repeated.state.events.length, pulled.state.events.length);
});

test("Core returns recoverable diagnostics for GitHub permission, rate-limit, and deletion outcomes", async () => {
  const tracker = new MemoryGitHubTracker();
  const created = await coreContract.pushGitHubIssueProjection({
    state: startState(),
    tracker,
    event: eventMetadata("CREATE", "2026-07-19T12:00:01Z"),
  });
  assert.equal(created.disposition, "created");
  if (created.disposition !== "created") {
    return;
  }
  const local = advanceToExplore(created.state);

  for (const [failure, expectedCode] of [
    ["permission-denied", "github.permission_denied"],
    ["rate-limited", "github.rate_limited"],
  ] as const) {
    tracker.failure = failure;
    const result = await coreContract.pushGitHubIssueProjection({
      state: local,
      tracker,
      event: eventMetadata(`UPDATE-${failure}`, "2026-07-19T12:03:00Z"),
    });
    assert.equal(result.disposition, "diagnostic");
    if (result.disposition === "diagnostic") {
      assert.equal(result.diagnostic.code, expectedCode);
      assert.equal(result.state, local);
      assert.equal(result.diagnostic.recoverable, true);
    }
  }

  tracker.failure = null;
  tracker.issue = null;
  const deleted = await coreContract.pullGitHubIssueProjection({
    state: created.state,
    tracker,
    event: eventMetadata("PULL-DELETED", "2026-07-19T12:04:00Z"),
  });
  assert.equal(deleted.disposition, "diagnostic");
  if (deleted.disposition === "diagnostic") {
    assert.equal(deleted.diagnostic.code, "github.issue_deleted");
    assert.equal(deleted.state, created.state);
    assert.equal(deleted.diagnostic.recoverable, true);
  }
});
