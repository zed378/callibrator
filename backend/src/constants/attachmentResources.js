/**
 * D-22 (ADR-083) — the ONE list of `attachments.resource_type` values.
 *
 * `resource_type` is a polymorphic tag with no foreign key (ADR-064 #8). It
 * used to be a free string on an unlinked upload: a typo attached a file to a
 * type nothing would ever query. Every value is now one of these, compared
 * without regard to case (the kanban card modal sends `KanbanCard`, the upload
 * modal `device`, the ticket editor `Ticket`). The service refuses anything
 * else with a 400 (attachment.service#assertLinkTarget), and the model refuses
 * it on every create path (models/attachment.model.js) — the same list both
 * times, so they cannot disagree.
 *
 *  - LINKABLE_RESOURCES — the types an attachment may be LINKED to a record of
 *    (a `resourceId`), keyed by lower-cased type, with the model that holds the
 *    record (A-97). Every model here carries `tenantId`.
 *  - STANDALONE_RESOURCE_TYPES — types that never carry a `resourceId`:
 *    `generic` (the default), `ticket` (images in a support ticket's
 *    description, RichTextEditor `imageResourceType="Ticket"`) and `post` (the
 *    CMS editor's type before ADR-042 moved published images to
 *    /content/media; kept so an older client is not refused).
 *
 * Rows written before this list existed may carry another value. They are not
 * rewritten (no migration can know what a typo meant); the model validates the
 * type only when it is written, so such a row can still be soft-deleted, and
 * the orphan report lists it as `unlinkable_type` when it carries an id.
 */

const LINKABLE_RESOURCES = Object.freeze({
  certificate: "Certificate",
  device: "CalibrationDevice",
  calibrationdevice: "CalibrationDevice",
  calibration: "CalibrationRecord",
  calibrationrecord: "CalibrationRecord",
  workorder: "MaintenanceWorkOrder",
  maintenanceworkorder: "MaintenanceWorkOrder",
  kanbancard: "KanbanCard",
});

const STANDALONE_RESOURCE_TYPES = Object.freeze(["generic", "ticket", "post"]);

const ATTACHMENT_RESOURCE_TYPES = Object.freeze([
  ...Object.keys(LINKABLE_RESOURCES),
  ...STANDALONE_RESOURCE_TYPES,
]);

/**
 * Whether `value` is an attachment resource type, ignoring case.
 * @param {unknown} value
 * @returns {boolean}
 */
const isAttachmentResourceType = (value) =>
  typeof value === "string" && ATTACHMENT_RESOURCE_TYPES.includes(value.toLowerCase());

module.exports = {
  LINKABLE_RESOURCES,
  STANDALONE_RESOURCE_TYPES,
  ATTACHMENT_RESOURCE_TYPES,
  isAttachmentResourceType,
};
