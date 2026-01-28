require('dotenv').config();
const StorageFactory = require('../storage/StorageFactory');

async function testS3Storage() {
  console.log('☁️  Testing S3 Storage...\n');

  // Force S3 storage
  process.env.STORAGE_DRIVER = 's3';

  // Check if AWS credentials are configured
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.S3_BUCKET_NAME) {
    console.log('⚠️  Warning: AWS credentials or S3 bucket not configured');
    console.log('   Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and S3_BUCKET_NAME');
    console.log('   Skipping S3 test...\n');
    return;
  }

  try {
    const storage = StorageFactory.getStorage();
    console.log(`✅ Storage driver: ${storage.getName()}\n`);

    // Create test buffer
    const testContent = 'This is a test PDF content for S3';
    const buffer = Buffer.from(testContent);

    // Test storage
    console.log('📤 Uploading test file to S3...');
    const filePath = await storage.store(
      buffer,
      'tenant-test',
      'batch-test',
      'job-test'
    );

    console.log(`✅ File uploaded successfully!`);
    console.log(`   S3 Key: ${filePath}\n`);

    // Test public URL retrieval
    const publicUrl = storage.getPublicUrl(filePath);
    console.log(`🔗 Public URL: ${publicUrl}\n`);

    console.log('✨ S3 storage test completed successfully!');
    console.log('💡 Note: You can verify the file in your S3 bucket');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testS3Storage();
