const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const DocumentBatch = sequelize.define('DocumentBatch', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  templateId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: 'ID of the user who uploaded the batch',
  },
  source: {
    type: DataTypes.ENUM('user', 'client'),
    defaultValue: 'user',
    comment: 'Source of the batch: user (from UI) or client (from API)',
  },
  clientId: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: 'Client ID if source is "client"',
    references: {
      model: 'clients',
      key: 'id',
    },
  },
  status: {
    type: DataTypes.ENUM('Pending', 'Processing', 'Completed', 'Failed'),
    defaultValue: 'Pending',
  },
  originalFileName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  totalRecords: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  // Justifai Blockchain Fields
  issuerId: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Issuer identifier for blockchain verification',
  },
  expiryDate: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Ed: Document expiry timestamp',
  },
  invalidationExpiry: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Ei: Invalidation-expiry timestamp',
  },
  issuerPublicKey: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Issuer public key for signature verification',
  },
  merkleRoot: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'MRI: Intermediate Merkle root for this batch',
  },
  merkleRootUltimate: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'MRU: Ultimate Merkle root (combination of multiple MRIs)',
  },
  merkleProofUltimate: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'MPU: Merkle proof connecting MRI to MRU',
  },
  txHash: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Blockchain transaction hash',
  },
  network: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Blockchain network name',
  },
  finalizedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Timestamp when batch was finalized',
  },
  signingStatus: {
    type: DataTypes.ENUM('PendingSigning', 'Signed', 'Finalized'),
    allowNull: true,
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {},
  },
}, {
  tableName: 'document_batches',
  timestamps: true,
});

module.exports = DocumentBatch;
