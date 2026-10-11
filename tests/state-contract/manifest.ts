// Independent acceptance requirements. Never generated from selectors or
// subscribers: production metadata is used only by the coverage guard.
export type Consumer = "document" | "catalog" | "search" | "breadcrumbs" | "map" | "security";
export type Contract = {
  id: string;
  item: string;
  path: string;
  value: unknown;
  fields: string[];
  consumers: Consumer[];
  label?: string;
};
export const contracts: Contract[] = [
  {id:"item.name",item:"login",path:"name",value:"Renamed contract login",fields:["ItemDraft.name"],consumers:["document","catalog","search","breadcrumbs","map"]},
  {id:"login.username",item:"login",path:"login.username",value:"updated-user",fields:["fields.login.username"],label:"Username",consumers:["document","catalog","search"]},
  {id:"item.notes",item:"note",path:"notes",value:null,fields:["ItemDraft.notes"],label:"Notes",consumers:["document"]},
  {id:"login.password",item:"login",path:"login.password",value:"Different password 123!",fields:["fields.login.password"],consumers:["security","map"]},
  {id:"item.folder",item:"login",path:"folderId",value:"other",fields:["ItemDraft.folderId"],consumers:["document","catalog","breadcrumbs"]},
  {id:"ssh.material",item:"ssh",path:"sshKey",value:null,fields:["fields.ssh_key.publicKey","fields.ssh_key.fingerprint","fields.ssh_key.privateKey"],consumers:["document","catalog"]},
];

// Explicit gaps, not executable coverage. A guard prevents *new* surfaces
// disappearing silently; these entries do not claim that the old ones pass.
export const deferred: Record<string,string> = {
  "ItemDraft.kind":"Creation/kind changes need create scenarios; update deliberately rejects kind changes.",
  "ItemDraft.orgId":"Moving between owners is refused; organization/collection scenarios need an organization authority.",
  "ItemDraft.collectionIds":"Needs organization permissions and a collection authority.",
  "ItemDraft.favorite":"Needs a favourite consumer specification.",
  "ItemDraft.reprompt":"Needs protected-action and reprompt consumers.",
  "ItemDraft.uris":"Needs URI and autofill consumers.",
  "ItemDraft.tags":"Needs plugin consumers and real plugin ingress.",
  "ItemDraft.sshKey":"Daemon-held drafts need the native daemon authority; web SSH material is a separate contract.",
  "fields.login.totp":"Needs code-time control and editor-only visibility requirements.",
  "fields.card.cardholderName":"Card matrix remains to be implemented.",
  "fields.card.brand":"Card matrix remains to be implemented.",
  "fields.card.number":"Needs masking/network/last-four consumer requirements.",
  "fields.card.expMonth":"Needs expiry and security consumers.",
  "fields.card.expYear":"Needs expiry and security consumers.",
  "fields.card.code":"Needs protected-copy and masking consumers.",
  "fields.identity.firstName":"Identity matrix remains to be implemented.",
  "fields.identity.lastName":"Identity matrix remains to be implemented.",
  "fields.identity.email":"Identity matrix remains to be implemented.",
  "fields.identity.phone":"Identity matrix remains to be implemented.",
  "fields.identity.company":"Identity matrix remains to be implemented.",
};
export const operations: Record<string,{contract?:string;reason?:string}> = {
  update:{contract:"item.name"},
  verifyPassword:{reason:"Read-only verification."},
  generate:{reason:"Ephemeral generated value; persistence starts at update/create."},
  memberFingerprint:{reason:"Read-only fingerprint calculation."},
  compareForMerge:{reason:"Read-only comparison."},
  create:{reason:"Creation matrix pending."},
  regenerate:{reason:"Native-only password regeneration pending."},
  merge:{reason:"Merge/duplicate/trash matrix pending."},
  createFolder:{reason:"Folder creation matrix pending."},
  renameFolder:{reason:"Folder rename matrix pending."},
  deleteFolder:{reason:"Folder removal and child relocation matrix pending."},
  createCollection:{reason:"Organization authority and access matrix pending."},
  renameCollection:{reason:"Organization authority and access matrix pending."},
  deleteCollection:{reason:"Organization authority and access matrix pending."},
  invite:{reason:"Organization/member authority pending."},
  setMember:{reason:"Organization/member authority pending."},
  confirmMember:{reason:"Organization/member authority pending."},
  removeMember:{reason:"Organization/member authority pending."},
};
