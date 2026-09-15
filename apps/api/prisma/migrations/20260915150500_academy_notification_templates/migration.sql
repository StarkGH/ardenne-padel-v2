-- Academy — Phase A : nouveaux templates de notification (proposition, confirmation, annulation de cours).
-- L'invitation élève (token brut) n'utilise PAS ce mécanisme : voir AcademyInvitationService (envoi direct, jamais via notification_outbox).

ALTER TYPE "NotificationTemplate" ADD VALUE 'ACADEMY_LESSON_PROPOSED';
ALTER TYPE "NotificationTemplate" ADD VALUE 'ACADEMY_LESSON_CONFIRMED';
ALTER TYPE "NotificationTemplate" ADD VALUE 'ACADEMY_LESSON_CANCELLED';
