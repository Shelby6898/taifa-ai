// Fixed, business-language question set for the plan: <description>
// flow, modeled on how a solution architect gathers requirements
// before touching architecture. Deterministic — no model call needed
// to decide what to ask, so question count and phrasing stay
// predictable and consistent across every planning session.
//
// Each question carries a `tag` matching a field in the Requirements
// Summary (see clarificationState.js's buildRequirementsSummary),
// so the summary can be built directly from tagged answers without a
// second model call that could drift or hallucinate.

const FIXED_PLANNING_QUESTIONS = [
  {
    tag: "users",
    text: "Who are the primary users of this (for example: general public, internal team members, specific customer segments, administrators)?"
  },
  {
    tag: "features",
    text: "Which features are required for the first release?"
  },
  {
    tag: "platforms",
    text: "Which platforms should this support — web, Android, iOS, or all of the above?"
  },
  {
    tag: "tech",
    text: "Do you have any preferred technologies or existing infrastructure (for example: React, Node.js, Firebase, PostgreSQL)?"
  },
  {
    tag: "scale",
    text: "What level of usage should the initial release support — a small prototype, up to 1,000 users, up to 10,000 users, or enterprise scale?"
  },
  {
    tag: "security",
    text: "Are there any security or compliance requirements (for example: email verification, multi-factor authentication, role-based access, audit logging)?"
  },
  {
    tag: "success",
    text: "What does success look like for the first version — what should users be able to do?"
  }
];

module.exports = { FIXED_PLANNING_QUESTIONS };

// Shorter set used when project memory already has established facts
// about this project (tech stack, platform, security approach, etc.)
// — asking the full 7-question discovery framework again for every
// incremental feature addition to an existing project is redundant
// and tedious. Only genuinely new information gets asked; everything
// else is pulled from memory and folded into the description directly.
const SHORT_PLANNING_QUESTIONS = [
  {
    tag: "features",
    text: "What does this addition need to do?"
  },
  {
    tag: "success",
    text: "What does success look like for this addition — what should users be able to do?"
  }
];

module.exports.SHORT_PLANNING_QUESTIONS = SHORT_PLANNING_QUESTIONS;
