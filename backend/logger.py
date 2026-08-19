from database import system_logs_collection
from datetime import datetime
from typing import Dict, Any, Optional

def log_audit(actor_id: str, action: str, target_id: Optional[str] = None, details: Optional[Dict[str, Any]] = None):
    """
    Standardized function to log auditable actions in the system.
    """
    log_doc = {
        "timestamp": datetime.utcnow(),
        "actor_id": actor_id,
        "action": action,
        "target_id": target_id,
        "details": details or {}
    }
    system_logs_collection.insert_one(log_doc)
