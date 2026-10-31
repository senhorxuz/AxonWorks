export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low'

export type ExpectedOutputKind =
  | 'file_path'
  | 'content_item'
  | 'artifact'
  | 'design_asset'
  | 'dataset'
  | 'other'

export interface AcceptanceCriterion {
  id: string
  description: string
  completed: boolean
}

export interface ExpectedOutput {
  id: string
  title: string
  kind: ExpectedOutputKind
  locator?: string
}

export interface AcceptanceCriterionInput {
  id?: string
  description: string
  completed?: boolean
}

export interface ExpectedOutputInput {
  id?: string
  title: string
  kind?: ExpectedOutputKind
  locator?: string
}

export interface CreateTaskContractFields {
  description?: string
  priority?: TaskPriority
  acceptanceCriteria?: AcceptanceCriterionInput[]
  dependencyTaskIds?: string[]
  expectedOutputs?: ExpectedOutputInput[]
}

export interface UpdateTaskContractInput {
  expectedVersion: number
  title?: string
  description?: string | null
  priority?: TaskPriority
  acceptanceCriteria?: AcceptanceCriterionInput[]
  dependencyTaskIds?: string[]
  expectedOutputs?: ExpectedOutputInput[]
}
