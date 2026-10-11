"""Issue a legacy invitation after an operator verifies the original account holder.

Usage: python -m backend.enroll <account-uuid>
Deliver stdout once over a trusted channel. No password or verification bypass.
"""
from datetime import datetime, timedelta, timezone
import secrets
import sys
import uuid
from .auth import digest
from .database import SessionLocal
from .models import User


def main():
    identity = uuid.UUID(sys.argv[1])
    with SessionLocal() as db:
        user = db.get(User, identity)
        if not user or user.password_hash or user.phone_verified_at:
            raise SystemExit('Account is not eligible for legacy enrollment')
        token = secrets.token_urlsafe(32)
        user.enrollment_hash = digest(token)
        user.enrollment_expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
        db.commit()
    print(token)


if __name__ == '__main__':
    main()
