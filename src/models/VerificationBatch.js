const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const VerificationBatch = sequelize.define('VerificationBatch', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  originalFilename: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Original filename of uploaded file (PDF or ZIP)',
  },
  fileType: {
    type: DataTypes.ENUM('pdf', 'zip'),
    allowNull: false,
    comment: 'Type of file that was uploaded',
  },
  totalPdfs: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Total number of PDFs in this batch',
  },
  status: {
    type: DataTypes.ENUM('Pending', 'Processing', 'Completed', 'Failed'),
    defaultValue: 'Pending',
    comment: 'Overall batch status',
  },
  completedCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Number of verification jobs completed',
  },
  validCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Number of valid certificates',
  },
  invalidCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Number of invalid certificates',
  },
  failedCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Number of failed verifications',
  },
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Error message if batch processing failed',
  },
}, {
  tableName: 'verification_batches',
  timestamps: true,
  indexes: [
    {
      fields: ['tenantId'],
    },
    {
      fields: ['status'],
    },
    {
      fields: ['createdAt'],
    },
  ],
});

module.exports = VerificationBatch;

