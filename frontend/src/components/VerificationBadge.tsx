import type { ReactElement } from 'react';

import type { FindingStatus } from '../app/types';

type BadgeStatus = FindingStatus | 'review-required' | 'unverified';

const labels: Record<BadgeStatus, string> = {
  supported: 'Supported',
  proposed: 'Proposed',
  disputed: 'Disputed',
  'review-required': 'Review required',
  unverified: 'Unverified',
};

export function VerificationBadge({ status }: { status: BadgeStatus }): ReactElement {
  return (
    <span className={`verification-badge verification-badge--${status}`}>
      <span aria-hidden="true" className="verification-badge__dot" />
      {labels[status]}
    </span>
  );
}
