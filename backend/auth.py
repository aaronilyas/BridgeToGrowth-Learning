"""Validate the existing external identity contract; the provider owns credentials."""
import re
import uuid

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer


def identity_dependency(authenticate):
    """Bind provider introspection to a request-scoped FastAPI dependency.

    Return the stable UUID and verified E.164 recipient used by registration.
    Reject unavailable providers and malformed identities before account access.
    """
    bearer = HTTPBearer(auto_error=False)

    def identity(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        if credentials is None:
            raise HTTPException(401, 'Authentication required', headers={'WWW-Authenticate': 'Bearer'})
        try:
            result = authenticate(credentials.credentials)
            if result.get('active') is not True:
                raise ValueError('Inactive session')
            user_id = uuid.UUID(result['user_id'])
            phone = result['phone_number']
            if result.get('phone_verified') is not True or not re.fullmatch(r'\+[1-9][0-9]{7,14}', phone):
                raise ValueError('Verified phone required')
        except Exception:
            raise HTTPException(401, 'Invalid or expired session', headers={'WWW-Authenticate': 'Bearer'}) from None
        return user_id, phone

    return identity
