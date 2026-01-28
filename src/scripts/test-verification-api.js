/**
 * Test certificate verification through the API
 */

const fs = require('fs').promises;
const FormData = require('form-data');
const axios = require('axios');

async function testVerification(pdfPath) {
  console.log('\n🔐 Testing Certificate Verification\n');
  console.log(`PDF: ${pdfPath}\n`);

  try {
    // Step 1: Upload certificate for verification
    console.log('📤 Uploading certificate...');
    const fileBuffer = await fs.readFile(pdfPath);
    const formData = new FormData();
    formData.append('files', fileBuffer, 'test-certificate.pdf');

    const uploadResponse = await axios.post(
      'http://localhost:3000/api/v1/documents/verify',
      formData,
      {
        headers: formData.getHeaders(),
      }
    );

    console.log('✅ Upload successful');
    console.log(`   Batch ID: ${uploadResponse.data.batchId}`);
    console.log(`   Total certificates: ${uploadResponse.data.totalCertificates}\n`);

    const batchId = uploadResponse.data.batchId;

    // Step 2: Poll for verification status
    console.log('⏳ Polling verification status...\n');
    
    let attempts = 0;
    const maxAttempts = 20;
    let finalStatus = null;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      
      const statusResponse = await axios.get(
        `http://localhost:3000/api/v1/documents/verify/${batchId}/status`
      );

      const status = statusResponse.data;
      attempts++;

      console.log(`Attempt ${attempts}:`);
      console.log(`  Valid: ${status.statusCounts.Valid || 0}`);
      console.log(`  Invalid: ${status.statusCounts.Invalid || 0}`);
      console.log(`  Pending: ${status.statusCounts.Pending || 0}`);
      console.log(`  Completed: ${status.completed}`);

      if (status.completed) {
        finalStatus = status;
        break;
      }
    }

    if (!finalStatus) {
      console.log('\n❌ Verification did not complete within timeout');
      return;
    }

    // Step 3: Display results
    console.log('\n📊 Final Verification Results:\n');
    console.log(`Total Jobs: ${finalStatus.totalJobs}`);
    console.log(`Completed: ${finalStatus.completedJobs}`);
    console.log(`\nStatus Breakdown:`);
    Object.entries(finalStatus.statusCounts).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });

    // Get detailed results for each job
    console.log('\n📋 Detailed Job Results:\n');
    for (const job of finalStatus.jobs) {
      console.log(`Job ${job.jobId}:`);
      console.log(`  Status: ${job.status}`);
      console.log(`  Filename: ${job.filename}`);
      
      if (job.errors && job.errors.length > 0) {
        console.log(`  ❌ Errors:`);
        job.errors.forEach(err => console.log(`     - ${err}`));
      }
      
      if (job.warnings && job.warnings.length > 0) {
        console.log(`  ⚠️  Warnings:`);
        job.warnings.forEach(warn => console.log(`     - ${warn}`));
      }
      
      if (job.status === 'Valid') {
        console.log(`  ✅ Certificate is VALID`);
      }
      
      console.log('');
    }

    // Overall result
    if (finalStatus.statusCounts.Valid > 0 && finalStatus.statusCounts.Invalid === 0) {
      console.log('🎉 SUCCESS: All certificates verified successfully!\n');
    } else if (finalStatus.statusCounts.Invalid > 0) {
      console.log('⚠️  WARNING: Some certificates failed verification\n');
    } else {
      console.log('❓ UNKNOWN: Verification status unclear\n');
    }

  } catch (error) {
    console.error('❌ Error during verification:', error.response?.data || error.message);
    if (error.response?.data) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Get PDF path from command line
const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node test-verification-api.js <path-to-pdf>');
  process.exit(1);
}

testVerification(pdfPath).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
