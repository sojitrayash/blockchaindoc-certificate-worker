const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const DocumentTemplate = sequelize.define('DocumentTemplate', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'HTML content with placeholders',
  },
  parameters: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
    comment: 'Array of { name, type, required }',
  },
  qrX: {
    type: DataTypes.INTEGER,
    defaultValue: 50,
  },
  qrY: {
    type: DataTypes.INTEGER,
    defaultValue: 50,
  },
  qrWidth: {
    type: DataTypes.INTEGER,
    defaultValue: 100,
  },
  qrHeight: {
    type: DataTypes.INTEGER,
    defaultValue: 100,
  },
  qrPage: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
}, {
  tableName: 'document_templates',
  timestamps: true,
});

module.exports = DocumentTemplate;
