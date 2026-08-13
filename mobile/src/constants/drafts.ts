// Mirrors MAX_DRAFTS_PER_PATIENT in backend/src/controllers/sessionDraftsController.js,
// which is the actual enforcement point — this only powers the frontend's
// preemptive "you're at the limit" gates before a form is even opened.
export const MAX_DRAFTS_PER_PATIENT = 2;
