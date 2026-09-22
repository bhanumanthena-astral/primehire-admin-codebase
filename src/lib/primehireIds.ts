/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Unique symbol for branding to prevent direct type assignment
declare const brand: unique symbol;

/**
 * Branded Types for PrimeHire Identifiers
 * 
 * CRITICAL GUARDRAIL: These branded/nominal types must ONLY be constructed using
 * the sanctioned as*Id() or toVerifiedCandidateUUID() functions.
 * Do not bypass this type-safety by casting directly (e.g., as JobId) in the application code.
 */
export type JobId = string & { readonly [brand]: 'JobId' };
export type LocalCandidateId = string & { readonly [brand]: 'LocalCandidateId' };
export type VerifiedCandidateUUID = string & { readonly [brand]: 'VerifiedCandidateUUID' };
export type InterviewId = string & { readonly [brand]: 'InterviewId' };
export type ResponseId = string & { readonly [brand]: 'ResponseId' };

/**
 * Sanctioned cast functions to construct branded types.
 * Use these ONLY when obtaining IDs from user input or verified API responses.
 */
export function asJobId(id: string): JobId {
  return id as JobId;
}

export function asLocalCandidateId(id: string): LocalCandidateId {
  return id as LocalCandidateId;
}

export function asInterviewId(id: string): InterviewId {
  return id as InterviewId;
}

export function asResponseId(id: string): ResponseId {
  return id as ResponseId;
}

/**
 * Regexp to validate standard UUID formats.
 */
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Verifies if a given string or LocalCandidateId matches the UUID format
 * and returns it as a VerifiedCandidateUUID. Throws an error otherwise.
 */
export function toVerifiedCandidateUUID(id: string): VerifiedCandidateUUID {
  if (!UUID_REGEX.test(id)) {
    throw new Error(`Invalid UUID format for VerifiedCandidateUUID: "${id}"`);
  }
  return id as VerifiedCandidateUUID;
}

/**
 * Flag to control the password reset feature status.
 * Must remain false until host/canonical UUID behaviour is verified with provider.
 */
export const PASSWORD_RESET_ENABLED = true;

/**
 * Generates a 32-bit random identifier formatted as an 8-character uppercase hex string.
 */
export function generate32BitId(): string {
  const num = Math.floor(Math.random() * 4294967296);
  return num.toString(16).padStart(8, '0').toUpperCase();
}
