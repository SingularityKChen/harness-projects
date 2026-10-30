/**
 * 五段查询文本是契约：改动它就要重录夹具（夹具带着文本哈希，见 tests/contract）。
 * 不取 author、login、email、creator、assignees 一类个人字段；仓库查询不取 `id`（仓库 node id 只在变更请求的成员关系核对里出现）。
 * 两个变更请求操作在文本末尾拼接同一个片段（GraphQL 要求片段定义与操作在同一文档），所以 list 与 get 解码的是同一组字段。
 */
const CHANGE_REQUEST_FIELDS = `fragment DevelopmentChangeRequestFields on PullRequest {
  id number title body state url updatedAt headRefName headRefOid isCrossRepository reviewDecision
}`

const DEVELOPMENT_REPOSITORY = `query DevelopmentRepository($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { name updatedAt defaultBranchRef { name } }
}`

const DEVELOPMENT_BRANCHES = `query DevelopmentBranches($owner: String!, $name: String!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/", first: $first, after: $after, orderBy: { field: ALPHABETICAL, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes { name target { oid } }
    }
  }
}`

const DEVELOPMENT_COMMIT = `query DevelopmentCommit($owner: String!, $name: String!, $oid: GitObjectID!) {
  repository(owner: $owner, name: $name) { object(oid: $oid) { __typename ... on Commit { oid messageHeadline } } }
}`

const DEVELOPMENT_CHANGE_REQUESTS = `query DevelopmentChangeRequests($owner: String!, $name: String!, $headRefName: String, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $headRefName, first: $first, after: $after, states: [OPEN, CLOSED, MERGED], orderBy: { field: CREATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { ...DevelopmentChangeRequestFields }
    }
  }
}

${CHANGE_REQUEST_FIELDS}`

const DEVELOPMENT_CHANGE_REQUEST = `query DevelopmentChangeRequest($owner: String!, $name: String!, $id: ID!) {
  repository(owner: $owner, name: $name) { id }
  node(id: $id) { __typename ... on PullRequest { ...DevelopmentChangeRequestFields repository { id } } }
}

${CHANGE_REQUEST_FIELDS}`

export const DEVELOPMENT_QUERIES = Object.freeze({
  DevelopmentRepository: DEVELOPMENT_REPOSITORY,
  DevelopmentBranches: DEVELOPMENT_BRANCHES,
  DevelopmentCommit: DEVELOPMENT_COMMIT,
  DevelopmentChangeRequests: DEVELOPMENT_CHANGE_REQUESTS,
  DevelopmentChangeRequest: DEVELOPMENT_CHANGE_REQUEST,
} as const satisfies Readonly<Record<'DevelopmentRepository' | 'DevelopmentBranches' | 'DevelopmentCommit' | 'DevelopmentChangeRequests' | 'DevelopmentChangeRequest', string>>)

/** 写操作独立于已录制的五段只读查询，不能混入其哈希/回放集合。 */
export const DEVELOPMENT_CREATE_OPERATIONS = Object.freeze({
  DevelopmentCreatePreflight: `query DevelopmentCreatePreflight($owner: String!, $name: String!, $headRef: String!, $baseRef: String!) {
  repository(owner: $owner, name: $name) {
    id nameWithOwner
    head: ref(qualifiedName: $headRef) { ...DevelopmentCreateRef }
    base: ref(qualifiedName: $baseRef) { ...DevelopmentCreateRef }
  }
}
fragment DevelopmentCreateRef on Ref {
  name prefix repository { id } target { __typename ... on Commit { oid } }
}`,
  DevelopmentCreateChangeRequest: `mutation DevelopmentCreateChangeRequest($input: CreatePullRequestInput!) {
  createPullRequest(input: $input) {
    pullRequest { __typename ...DevelopmentChangeRequestFields repository { id } headRepository { id } baseRefName }
  }
}

${CHANGE_REQUEST_FIELDS}`,
} as const)
