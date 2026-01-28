const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const VerificationJob = sequelize.define('VerificationJob', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  verificationBatchId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'Groups multiple verification jobs from the same upload',
  },
  filename: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Original filename of the PDF',
  },
  storedPath: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Path where PDF is stored (local or S3)',
  },
  status: {
    type: DataTypes.ENUM('Pending', 'Processing', 'Valid', 'Invalid', 'Failed'),
    defaultValue: 'Pending',
  },
  verificationBundle: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'VD: Extracted verification bundle from PDF',
  },
  verificationResult: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Complete verification result including errors, warnings, and steps',
  },
  errors: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Array of verification errors',
  },
  warnings: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Array of verification warnings',
  },
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Error message if verification failed',
  },
}, {
  tableName: 'verification_jobs',
  timestamps: true,
  indexes: [
    {
      fields: ['tenantId'],
    },
    {
      fields: ['verificationBatchId'],
    },
    {
      fields: ['status'],
    },
  ],
});

module.exports = VerificationJob;

