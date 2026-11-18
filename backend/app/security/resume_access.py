from fastapi import HTTPException


def require_original_resume(user):
    if user.role == "recruiter":
        raise HTTPException(
            403, "Original resumes are available only to authorized administrators."
        )


def can_read_original_resume(user):
    return user.role != "recruiter"
