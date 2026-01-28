const DocumentJob = require('../models/DocumentJob');
const DocumentBatch = require('../models/DocumentBatch');
const DocumentTemplate = require('../models/DocumentTemplate');
const logger = require('../utils/logger');

/**
 * Fetch pending jobs from the database
 * @param {number} limit - Maximum number of jobs to fetch
 * @returns {Promise<Array>} - Array of pending jobs
 */
async function fetchPendingJobs(limit = 5) {
  try {
    const jobs = await DocumentJob.findAll({
      where: { status: 'Pending' },
      limit,
      order: [['createdAt', 'ASC']], // Process oldest first
    });

    logger.debug(`Fetched ${jobs.length} pending jobs`);
    return jobs;
  } catch (error) {
    logger.error('Error fetching pending jobs:', error);
    throw error;
  }
}

/**
 * Get job with associated template and batch information
 * @param {string} jobId - Job ID
 * @returns {Promise<object>} - Job with template and batch
 */
async function getJobWithTemplate(jobId) {
  try {
    const job = await DocumentJob.findByPk(jobId, {
      include: [
        {
          model: DocumentBatch,
          as: 'batch',
          include: [
            {
              model: DocumentTemplate,
              as: 'template',
            },
            {
              model: require('../models/Tenant'),
              as: 'tenant',
            },
          ],
        },
      ],
    });

    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    logger.debug('Job fetched with template', { jobId });
    return job;
  } catch (error) {
    logger.error('Error fetching job with template:', error);
    throw error;
  }
}

/**
 * Update job status and related fields
 * @param {string} jobId - Job ID
 * @param {string} status - New status
 * @param {object} updates - Additional fields to update
 * @returns {Promise<void>}
 */
async function updateJobStatus(jobId, status, updates = {}) {
  try {
    await DocumentJob.update(
      { status, ...updates },
      { where: { id: jobId } }
    );

    logger.info('Job status updated', { jobId, status, updates });
  } catch (error) {
    logger.error('Error updating job status:', error);
    throw error;
  }
}

/**
 * Mark job as processing to prevent duplicate processing
 * @param {string} jobId - Job ID
 * @returns {Promise<boolean>} - True if successfully marked as processing
 */
async function markJobAsProcessing(jobId) {
  try {
    const [affectedRows] = await DocumentJob.update(
      { status: 'Processing' },
      {
        where: {
          id: jobId,
          status: 'Pending' // Only update if still pending
        }
      }
    );

    return affectedRows > 0;
  } catch (error) {
    logger.error('Error marking job as processing:', error);
    return false;
  }
}

module.exports = {
  fetchPendingJobs,
  getJobWithTemplate,
  updateJobStatus,
  markJobAsProcessing,
};
