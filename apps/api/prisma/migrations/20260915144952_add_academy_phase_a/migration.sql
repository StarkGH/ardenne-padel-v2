-- Academy — Phase A (MVP disponibilités). Voir ACADEMY_ARCHITECTURE.md.

-- CreateEnum
CREATE TYPE "AcademyActorType" AS ENUM ('TEACHER', 'STUDENT');

-- CreateEnum
CREATE TYPE "AcademyCourseType" AS ENUM ('INDIVIDUAL', 'GROUP');

-- CreateEnum
CREATE TYPE "AcademyLessonStatus" AS ENUM ('DRAFT', 'PROPOSED', 'CONFIRMED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'COACH';

-- CreateTable
CREATE TABLE "academy_students" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academy_students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academy_invitations" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "used_at" TIMESTAMP(3),

    CONSTRAINT "academy_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academy_availabilities" (
    "id" TEXT NOT NULL,
    "actor_type" "AcademyActorType" NOT NULL,
    "teacher_id" TEXT,
    "student_id" TEXT,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "recurrence" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academy_availabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academy_course_requests" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "requested_hours" DOUBLE PRECISION NOT NULL,
    "course_type" "AcademyCourseType" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academy_course_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academy_lessons" (
    "id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "booking_id" TEXT,
    "status" "AcademyLessonStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academy_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academy_lesson_participants" (
    "lesson_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,

    CONSTRAINT "academy_lesson_participants_pkey" PRIMARY KEY ("lesson_id","student_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "academy_students_user_id_key" ON "academy_students"("user_id");

-- CreateIndex
CREATE INDEX "academy_students_email_idx" ON "academy_students"("email");

-- CreateIndex
CREATE UNIQUE INDEX "academy_invitations_token_hash_key" ON "academy_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "academy_invitations_student_id_idx" ON "academy_invitations"("student_id");

-- CreateIndex
CREATE INDEX "academy_availabilities_teacher_id_idx" ON "academy_availabilities"("teacher_id");

-- CreateIndex
CREATE INDEX "academy_availabilities_student_id_idx" ON "academy_availabilities"("student_id");

-- CreateIndex
CREATE INDEX "academy_course_requests_student_id_idx" ON "academy_course_requests"("student_id");

-- CreateIndex
CREATE INDEX "academy_lessons_teacher_id_idx" ON "academy_lessons"("teacher_id");

-- AddForeignKey
ALTER TABLE "academy_students" ADD CONSTRAINT "academy_students_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academy_invitations" ADD CONSTRAINT "academy_invitations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "academy_students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academy_availabilities" ADD CONSTRAINT "academy_availabilities_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academy_availabilities" ADD CONSTRAINT "academy_availabilities_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "academy_students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academy_course_requests" ADD CONSTRAINT "academy_course_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "academy_students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academy_lessons" ADD CONSTRAINT "academy_lessons_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academy_lesson_participants" ADD CONSTRAINT "academy_lesson_participants_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "academy_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academy_lesson_participants" ADD CONSTRAINT "academy_lesson_participants_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "academy_students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
