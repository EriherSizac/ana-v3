// File: s3
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { S3Client } from '@aws-sdk/client-s3';

// WHEN_REQUIRED: no agregar checksum CRC32 automático a los presigned PUT
// (rompía la firma → 403 desde el navegador).
export const s3 = new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED' });
export const CSV_BUCKET = process.env.CSV_BUCKET!;
export const MEDIA_BUCKET = process.env.MEDIA_BUCKET!;
