export {
  createProjectBundle,
  createProjectBundleV2,
  createProjectBundleV3,
  MAX_BUNDLE_SERIALIZED_BYTES,
  parseProjectBundle,
  projectBundleSchema,
  projectBundleV1Schema,
  projectBundleV2Schema,
  projectBundleV3Schema,
  projectDetailSchema,
} from './bundle.js'

export { PortabilityError } from './errors.js'

export {
  DEFAULT_BUDGET_CHARS,
  INSPECTION_DISCLAIMER_PTBR,
  inspectWorkspace,
  MAX_BUDGET_CHARS,
  MAX_FILE_READ_BYTES,
  MAX_INSPECTION_FILES,
  MIN_BUDGET_CHARS,
} from './inspector.js'

export {
  isBinaryBuffer,
  isContainedInRoot,
  maskSecrets,
  type PathValidationResult,
  validateRelativeFilePath,
  validateWorkspacePath,
} from './security.js'

export type {
  InspectedFile,
  InspectWorkspaceInput,
  ProjectBundle,
  WorkspaceInspection,
  WorkspaceInspectionSummary,
} from '../../shared/portability.js'
