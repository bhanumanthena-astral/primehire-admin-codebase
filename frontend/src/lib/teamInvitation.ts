const TEAM_INVITATION_ORIGIN = 'https://elitehr.vils.ai';

/** Team members always join through the canonical public application. */
export function teamInvitationUrl(value: string): string {
  const invitation = new URL(value, TEAM_INVITATION_ORIGIN);
  if (invitation.pathname !== '/accept-invite') {
    throw new Error('Invalid invitation link. Please create a new invitation.');
  }
  return `${TEAM_INVITATION_ORIGIN}${invitation.pathname}${invitation.search}${invitation.hash}`;
}
