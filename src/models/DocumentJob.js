const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const DocumentJob = sequelize.define('DocumentJob', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  batchId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  source: {
    type: DataTypes.ENUM('user', 'client'),
    defaultValue: 'user',
    comment: 'Source of the job: user (from UI) or client (from API)',
  },
  data: {
    type: DataTypes.JSONB,
    allowNull: false,
    comment: 'The actual data for this document instance',
  },
  recipientEmail: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Explicitly extracted email address for sending',
    field: 'recipient_email',
  },
  status: {
    type: DataTypes.ENUM('Pending', 'Processing', 'PendingSigning', 'Generated', 'Failed'),
    defaultValue: 'Pending',
  },
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  certificatePath: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'S3 path to the generated certificate',
  },
  qrCodePath: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Path to the QR code image for verification',
    field: 'qr_code_path',
  },
  certificateWithQRPath: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Path to certificate PDF with embedded QR code annotation',
    field: 'certificate_with_qr_path',
  },
  // Justifai Algorithm Fields
  documentHash: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'H(d): Keccak-256 hash of PDF',
  },
  dataHash: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'data_hash: Content-based hash (canonicalized text/OCR tokens) for robust verification',
    field: 'data_hash',
  },
  documentFingerprint: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'DI: Document fingerprint',
  },
  fingerprintHash: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'H(DI): Hash to be signed',
  },
  issuerSignature: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'SI: SECP256K1 signature',
  },
  merkleLeaf: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'L: Merkle tree leaf',
  },
  merkleProofIntermediate: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'MPI: Merkle proof connecting L to MRI',
  },
  merkleProofUltimate: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'MPU: Merkle proof connecting MRI to MRU',
  },
  verificationBundle: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'VD: Complete verification data',
  },
  qrPayloadFragment: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'QR payload fragment (v2): deflateRaw(JSON) base64url. Opaque storage for previews/verification.',
    field: 'qr_payload_fragment',
  },
}, {
  tableName: 'document_jobs',
  timestamps: true,
});

module.exports = DocumentJob;
