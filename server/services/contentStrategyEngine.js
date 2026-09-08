// ─── Content Strategy Engine ─────────────────────────────────────────────────
// Decides WHICH FORMAT an article should take (ultimate guide, product review,
// comparison, checklist, FAQ, etc.) — separate from and layered on top of the
// existing CONTENT_TYPES voice system in aiService.js (blog/article/affiliate/
// news/review/buyingGuide/opinion), which is left completely untouched. Each
// format maps to one of those existing voices for the underlying writing pipeline,
// plus a styleInstruction string that rides in through generatePost's EXISTING
// `tone` parameter — a free-text field every caller already supports, currently
// always passed as '' by the Auto Publisher. Reusing it here means zero changes
// were needed to aiService.js's actual writing pipeline: this is a new decision
// layer, not a new writing engine.
//
// "Interview" is deliberately implemented as an EXPERT Q&A format, not a simulated
// conversation attributed to a specific named person — inventing quotes from a
// fabricated interviewee would be presenting fiction as a real source, which this
// system avoids throughout (see aiService.generatePost's sourcing rules and
// verifyResearch). The Q&A structure itself is a legitimate, common article format
// without needing an invented person behind it.

const FORMAT_ARCHETYPES = {
  ultimateGuide: {
    contentType: 'article',
    label: 'Ultimate Guide',
    styleInstruction: 'Write this as a comprehensive, ultimate/definitive guide — cover the topic thoroughly enough that a reader needs no other source, organized so a beginner can follow it start to finish and an experienced reader can jump to the section they need.',
  },
  beginnerGuide: {
    contentType: 'blog',
    label: "Beginner's Guide",
    styleInstruction: "Write this as a beginner's guide — assume no prior knowledge, define terms as you introduce them, and prioritize clarity and confidence-building over exhaustive depth.",
  },
  productReview: {
    contentType: 'review',
    label: 'Product Review',
    styleInstruction: 'Write this as a hands-on-feeling product review with a clear final verdict — genuine pros and cons, who it is and is not a good fit for.',
  },
  comparison: {
    contentType: 'affiliate',
    label: 'Comparison',
    styleInstruction: 'Write this as a head-to-head comparison — a clear structure contrasting the options directly, ending with specific "best for X" recommendations rather than a single universal winner.',
  },
  bestXForY: {
    contentType: 'buyingGuide',
    label: 'Best X for Y List',
    styleInstruction: 'Write this as a "best X for Y" list — each entry names a specific standout reason/use-case it wins on, not a generic repeated description across entries.',
  },
  roundup: {
    contentType: 'buyingGuide',
    label: 'Roundup',
    styleInstruction: 'Write this as a roundup collecting the strongest current options — brief, punchy coverage per item, with a short closing note on how they compare overall.',
  },
  tutorial: {
    contentType: 'blog',
    label: 'Tutorial',
    styleInstruction: 'Write this as a step-by-step tutorial — numbered, sequential steps a reader can literally follow along with, each step doing one clear thing.',
  },
  checklist: {
    contentType: 'blog',
    label: 'Checklist',
    styleInstruction: 'Write this as an actionable checklist — organize the body around a clear checkable sequence of items the reader can work through, with just enough explanation per item to know why it matters.',
  },
  faq: {
    contentType: 'article',
    label: 'FAQ',
    styleInstruction: 'Write this as a genuine FAQ — structure the body as real, specific questions a reader would actually ask (not generic ones) each with a direct, complete answer.',
  },
  caseStudy: {
    contentType: 'article',
    label: 'Case Study',
    styleInstruction: 'Write this as a case-study-style piece — grounded in a specific concrete example, scenario, or dataset from the research, walking through what happened and what it implies, not abstract generalities.',
  },
  opinionPiece: {
    contentType: 'opinion',
    label: 'Opinion Piece',
    styleInstruction: 'Write this as a defended opinion piece with a clear stated stance, argued honestly with real reasoning — acknowledge the strongest counterargument rather than ignoring it.',
  },
  industryNews: {
    contentType: 'news',
    label: 'Industry News',
    styleInstruction: 'Write this as straight industry news reporting — lead with what happened, then why it matters, in that order.',
  },
  trendAnalysis: {
    contentType: 'article',
    label: 'Trend Analysis',
    styleInstruction: 'Write this as a trend analysis — establish the pattern with real specifics from the research, then focus most of the piece on what it actually means going forward, not just restating that the trend exists.',
  },
  mythsVsFacts: {
    contentType: 'article',
    label: 'Myths vs. Facts',
    styleInstruction: 'Structure this explicitly around myth-vs-fact pairs — state a specific common misconception, then correct it with the real, research-backed answer, repeated for each major point.',
  },
  qAndA: {
    contentType: 'article',
    label: 'Expert Q&A',
    styleInstruction: 'Write this in a question-and-answer format covering the questions a reader genuinely has — direct, expert-toned answers. Do NOT attribute answers to any specific named individual or invent an interviewee; this is a Q&A explainer, not a simulated interview with a real person.',
  },
};

// Which archetypes are inherently product/affiliate-shaped — used to gate the Auto
// Publisher's product-pool lookup so affiliate insertion only triggers for a format
// where it actually makes sense, kept separate from the normal blog path entirely
// when affiliate mode is off (see autoPublisherEngine.js).
const AFFILIATE_SUITABLE_FORMATS = new Set(['productReview', 'comparison', 'bestXForY', 'roundup']);

function isValidFormat(name) {
  return Object.prototype.hasOwnProperty.call(FORMAT_ARCHETYPES, name);
}

function getFormatNames() {
  return Object.keys(FORMAT_ARCHETYPES);
}

function getFormat(name) {
  return FORMAT_ARCHETYPES[name] || null;
}

function isAffiliateSuitable(name) {
  return AFFILIATE_SUITABLE_FORMATS.has(name);
}

module.exports = { FORMAT_ARCHETYPES, getFormatNames, getFormat, isValidFormat, isAffiliateSuitable };
