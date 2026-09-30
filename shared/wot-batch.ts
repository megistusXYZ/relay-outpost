/**
 * The most people one trust-score lookup request (/api/brainstorm/wot-batch)
 * may carry. The app splits its lookups by it and the server takes no more,
 * so the two can't drift: a person past the server's cap would come back
 * without an answer.
 */
export const WOT_BATCH_MAX = 200;
