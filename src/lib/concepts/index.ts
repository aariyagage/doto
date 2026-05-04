// Public surface of the concepts pipeline.
// Importers should reach through this barrel rather than deep-importing.

export * from './types';

export { runConceptGenerator } from './concept-generator';
export type { RunConceptGeneratorArgs } from './concept-generator';

export { runValidator } from './validator';
export type { RunValidatorArgs, ValidatorResult } from './validator';

export { runStylist, runStylistBatch } from './stylist';
export type { RunStylistArgs, StylistResult } from './stylist';

export {
    CONCEPT_DEDUP_COSINE_THRESHOLD,
    dedupeWithinBatch,
    filterAgainstSavedConcepts,
    filterAgainstSavedLegacyIdeas,
} from './dedup';
export type { CandidateWithEmbedding, BatchDedupResult } from './dedup';

export { recordConceptEvent, recordConceptEventsBulk } from './events';
export type { RecordEventArgs } from './events';

export {
    openPipelineRun,
    closePipelineRun,
    tallyGroqCall,
    tallyHfCall,
} from './pipeline-run';
export type { PipelineRunHandle, OpenPipelineRunArgs, ClosePipelineRunArgs } from './pipeline-run';

export {
    CONCEPT_PASS_SYSTEM_MESSAGE,
    buildConceptUserMessage,
} from './prompts/concept-prompt';
export type { BuildConceptPromptArgs, ConceptPromptEssence, ConceptPromptPillar } from './prompts/concept-prompt';

export {
    VALIDATOR_SYSTEM_MESSAGE,
    buildValidatorUserMessage,
} from './prompts/validator-prompt';
export type { BuildValidatorPromptArgs, ValidatorPriorItem } from './prompts/validator-prompt';

export {
    STYLIST_SYSTEM_MESSAGE,
    buildStylistUserMessage,
} from './prompts/stylist-prompt';
export type { BuildStylistPromptArgs, StylistVoiceProfile } from './prompts/stylist-prompt';

export {
    expandBrainstormNote,
    clusterInboxNotes,
    promoteBrainstormToDraftConcept,
    reembedBrainstormNote,
    EXPAND_SYSTEM_MESSAGE,
} from './brainstorm';
export type {
    ExpandResult,
    ClusterResult,
    PromoteArgs,
    PromoteResult,
} from './brainstorm';

export {
    runResearch,
    RESEARCH_SYSTEM_MESSAGE,
} from './research';
export type {
    RunResearchArgs,
    ResearchResult,
    ResearchCitation,
} from './research';
