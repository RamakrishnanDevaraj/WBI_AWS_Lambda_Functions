import { Buffer } from 'buffer';
import https from 'https';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

// Initialize DynamoDB client
const dynamoDbClient = new DynamoDBClient({ region: 'eu-north-1' });

export const handler = async (event) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const WHATSAPP_TOKEN = process.env.WHATSAPP_SECRET;
  let response;

  if (event?.requestContext?.http?.method === "GET") {
    let queryParams = event?.queryStringParameters;
    if (queryParams) {
      const mode = queryParams["hub.mode"];
      if (mode === "subscribe") {
        const verifyToken = queryParams["hub.verify_token"];
        if (verifyToken === VERIFY_TOKEN) {
          const challenge = queryParams["hub.challenge"];
          response = {
            statusCode: 200,
            body: challenge,
            isBase64Encoded: false,
          };
        }
        else {
          response = {
            statusCode: 403,
            body: JSON.stringify("Error, wrong validation token"),
            isBase64Encoded: false,
          };
        }
      }
      else {
        response = {
          statusCode: 403,
          body: JSON.stringify("Error, wrong mode"),
          isBase64Encoded: false,
        };
      }
    }
    else {
      response = {
        statusCode: 403,
        body: JSON.stringify("Error, no query parameters"),
        isBase64Encoded: false,
      };
    }
  }
  else if (event?.requestContext?.http?.method === "POST") {
    let body = JSON.parse(event.body);
    let entries = body.entry;

    for (let entry of entries) {
      for (let change of entry.changes) {
        let value = change.value;
        if (value) {
          let phone_number_id = value.metadata.phone_number_id;
          if (value.messages) {
            for (let message of value.messages) {
              const messageId = message.id;

              // Check if the messageId already exists in DynamoDB
              const isProcessed = await checkIfProcessed(messageId);
              if (isProcessed) {
                console.log("Message already processed, skipping:", messageId);
                continue;
              }

              if (message.type === 'text') {
                let from = message.from;
                let message_body = message.text.body;
                try {
                  await saveProcessedMessage(messageId, null); // Save text messageId with no contentVersionId
                  
                  const whatsAppMessageId = await createWhatsAppMessages({
                    WBI_MessageContent__c : message_body,
                    WBI_MessageType__c : message.type,
                    WBI_MessageId__c : messageId,
                    WBI_Customer_Phone__c : message?.from,
                    WBI_Customer_Name__c : value.contacts[0].profile.name,
                  });
                }
                catch (error) {
                  console.error("Error sending reply:", error);
                }

                response = {
                  statusCode: 200,
                  body: JSON.stringify("Message processed"),
                  isBase64Encoded: false,
                };
              } else if (message.type === 'document') {
                const document = message.document;
                const documentId = document.id;
                const mimeType = document.mime_type;

                console.log(`Document Received: ${document.filename}, Mime Type: ${mimeType}`);

                try {
                  const mediaUrl = await getMediaUrl(documentId);
                  const rawData = await downloadMedia(mediaUrl);
                  // Save message ID first, then update with content version ID
                  await saveProcessedMessage(messageId, null); // Initially save with null
                  const contentVersionId = await createContentVersion(document.filename, mimeType, rawData);
                  await updateProcessedMessage(messageId, contentVersionId); // Update with content version ID
                  
                  const whatsAppMessageId = await createWhatsAppMessages({
                    WBI_MessageContent__c : '',
                    WBI_MessageType__c : message.type,
                    WBI_MessageId__c : messageId,
                    WBI_MediaId__c : documentId,
                    WBI_Customer_Phone__c : message?.from,
                    WBI_Customer_Name__c : value.contacts[0].profile.name,
                    WBI_ContentVersionId__c : JSON.parse(contentVersionId)?.id
                  });
                  
                }
                catch (error) {
                  console.error('Error fetching document:', error);
                }
              } else if (message.type === 'image') {
                const image = message.image;
                const imageId = image.id;
    
                console.log(`Image Received: ${imageId}`);
                const mediaUrl = await getMediaUrl(imageId);
                const rawData = await downloadMedia(mediaUrl);
                await saveProcessedMessage(messageId, null); // Initially save with null
                const contentVersionId = await createContentVersion('image.jpg', 'image/jpeg', rawData);
                await updateProcessedMessage(messageId, contentVersionId);
                
                const whatsAppMessageId = await createWhatsAppMessages({
                  WBI_MessageContent__c : '',
                  WBI_MessageType__c : message.type,
                  WBI_MessageId__c : messageId,
                  WBI_MediaId__c : imageId,
                  WBI_Customer_Phone__c : message?.from,
                  WBI_Customer_Name__c : value.contacts[0].profile.name,
                  WBI_ContentVersionId__c : JSON.parse(contentVersionId)?.id
                });
              } else if (message.type === 'video') {
                const video = message.video;
                const videoId = video.id;
    
                console.log(`Video Received: ${videoId}`);
                const mediaUrl = await getMediaUrl(videoId);
                const rawData = await downloadMedia(mediaUrl);
                await saveProcessedMessage(messageId, null); // Initially save with null
                const contentVersionId = await createContentVersion('video.mp4', 'video/mp4', rawData);
                await updateProcessedMessage(messageId, contentVersionId);
                
                const whatsAppMessageId = await createWhatsAppMessages({
                  WBI_MessageContent__c : '',
                  WBI_MessageType__c : message.type,
                  WBI_MessageId__c : messageId,
                  WBI_MediaId__c : videoId,
                  WBI_Customer_Phone__c : message?.from,
                  WBI_Customer_Name__c : value.contacts[0].profile.name,
                  WBI_ContentVersionId__c : JSON.parse(contentVersionId)?.id
                });
              } else if (message.type === 'audio') {  // Handle audio messages
                const audio = message.audio;
                const audioId = audio.id;
    
                console.log(`Audio Received: ${audioId}`);
                const mediaUrl = await getMediaUrl(audioId);
                const rawData = await downloadMedia(mediaUrl);
                await saveProcessedMessage(messageId, null); // Initially save with null
                const contentVersionId = await createContentVersion('audio.mp3', 'audio/mpeg', rawData);
                await updateProcessedMessage(messageId, contentVersionId);
                
                const whatsAppMessageId = await createWhatsAppMessages({
                  WBI_MessageContent__c : '',
                  WBI_MessageType__c : message.type,
                  WBI_MessageId__c : messageId,
                  WBI_MediaId__c : audioId,
                  WBI_Customer_Phone__c : message?.from,
                  WBI_Customer_Name__c : value.contacts[0].profile.name,
                  WBI_ContentVersionId__c : JSON.parse(contentVersionId)?.id
                });
              } else {
                console.log('Received unsupported message type:', message);
              } 
            }
          }
        }
      }
    }
  }
  else {
    response = {
      statusCode: 403,
      body: JSON.stringify("Unsupported method"),
      isBase64Encoded: false,
    };
  }

  return response;
};

const sendReply = (phone_number_id, whatsapp_token, to, reply_message) => {
  return new Promise((resolve, reject) => {
    let json = {
      messaging_product: "whatsapp",
      to: to,
      text: { body: reply_message },
    };
    let data = JSON.stringify(json);
    let path = `/v20.0/${phone_number_id}/messages?access_token=${whatsapp_token}`;
    let options = {
      host: "graph.facebook.com",
      path: path,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    };

    let req = https.request(options, (response) => {
      let str = "";
      response.on("data", (chunk) => {
        str += chunk;
      });
      response.on("end", () => {
        const jsonResponse = JSON.parse(str);
        if (response.statusCode === 200) {
          console.log("Message sent successfully:", jsonResponse);
          resolve();
        }
        else {
          console.error("Failed to send message:", jsonResponse);
          reject(new Error("Failed to send message"));
        }
      });
    });

    req.on("error", (e) => {
      reject(e);
    });

    req.write(data);
    req.end();
  });
};

// Function to check if the message has been processed
async function checkIfProcessed(messageId) {
  const params = {
    TableName: 'ProcessedMessages',
    Key: { messageId: messageId }
  };

  try {
    const result = await dynamoDbClient.send(new GetCommand(params));
    return !!(result.Item); // Return true if the item exists
  }
  catch (error) {
    console.error('Error checking message in DynamoDB:', error);
    return false;
  }
}

// Function to save messageId with null initially
async function saveProcessedMessage(messageId, contentVersionId) {
  const params = {
    TableName: 'ProcessedMessages',
    Item: {
      messageId: messageId,
      contentVersionId: contentVersionId || null, // Store the contentVersionId if present
    }
  };

  try {
    await dynamoDbClient.send(new PutCommand(params));
    console.log(`Message saved to DynamoDB: ${messageId}`);
  }
  catch (error) {
    console.error('Error saving message to DynamoDB:', error);
  }
}

// Function to update contentVersionId after initial save
async function updateProcessedMessage(messageId, contentVersionId) {
  const params = {
    TableName: 'ProcessedMessages',
    Item: {
      messageId: messageId,
      contentVersionId: contentVersionId, // Update with new contentVersionId
    }
  };

  try {
    await dynamoDbClient.send(new PutCommand(params));

    console.log(`Updated contentVersionId in DynamoDB for message: ${messageId}`);
  }
  catch (error) {
    console.error('Error updating message in DynamoDB:', error);
  }
}

// Function to get the media URL from WhatsApp using the media ID
async function getMediaUrl(mediaId) {
  const options = {
    hostname: 'graph.facebook.com',
    path: `/v20.0/${mediaId}`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${process.env.WHATSAPP_SECRET}`,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const response = JSON.parse(data);
        resolve(response.url); // Media URL returned
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.end();
  });
}

// Function to download the media content
async function downloadMedia(mediaUrl) {
  return new Promise((resolve, reject) => {
    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_SECRET}`,
        'User-Agent': 'waMediaRequester',
      },
    };

    const req = https.request(mediaUrl, options, (res) => {
      let data = [];
      res.on('data', (chunk) => {
        data.push(chunk);
      });
      res.on('end', () => {
        const completeData = Buffer.concat(data);
        resolve(completeData); // Resolve with the complete data
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.end();
  });
}

// Function to create a Content Version in Salesforce using multipart/form-data
async function createContentVersion(filename, mimeType, fileData) {
  const instanceUrl = process.env.SF_INSTANCE_URL;

  const tokenData = await getAccessTokenService();
  const accessToken = tokenData.access_token;

  return new Promise((resolve, reject) => {

    const options = {
      hostname: instanceUrl,
      path: '/services/data/v61.0/sobjects/ContentVersion/',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/form-data; boundary=${'----WebKitFormBoundary7MA4YWxkTrZu0gW'}`,
      },
    };

    const multipartBody = buildMultipartBody(filename, mimeType, fileData);

    const req = https.request(options, (res) => {
      let responseBody = '';

      res.on('data', (chunk) => {
        responseBody += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 201) {
          resolve(responseBody);
        }
        else {
          reject(new Error(`Status Code: ${res.statusCode}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(multipartBody);
    req.end();
  });
}

// Helper function to build multipart body
function buildMultipartBody(filename, mimeType, fileData) {
  const CRLF = '\r\n';
  const BOUNDARY = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  let multipartBody = Buffer.alloc(0);

  const jsonPart = Buffer.from(
    `--${BOUNDARY}${CRLF}` +
    `Content-Disposition: form-data; name="entity_content";${CRLF}` +
    `Content-Type: application/json${CRLF}${CRLF}` +
    JSON.stringify({
      Title: filename,
      PathOnClient: filename,
    }) + CRLF
  );

  const filePartHeader = Buffer.from(
    `--${BOUNDARY}${CRLF}` +
    `Content-Disposition: form-data; name="VersionData"; filename="${filename}"${CRLF}` +
    `Content-Type: ${mimeType}${CRLF}${CRLF}`
  );

  const filePartFooter = Buffer.from(`${CRLF}--${BOUNDARY}--${CRLF}`);

  // Concatenate everything as binary Buffer
  multipartBody = Buffer.concat([multipartBody, jsonPart, filePartHeader, fileData, filePartFooter]);

  return multipartBody;
}


const getAccessToken = () => {
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.SF_CLIENT_ID,
    client_secret: process.env.SF_CLIENT_SECRET,
  });

  const { hostname, pathname } = new URL(process.env.SF_ACCESS_TOKEN_ENDPOINT);

  const options = {
    hostname,
    path: pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(params.toString()),
    },
  };


  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log('Response Status Code:', res.statusCode); // Log status code
        res.statusCode === 200 ?
          resolve(JSON.parse(body)) :
          reject(`Failed to get token: ${body}`);
      });
    });

    req.on('error', (error) => {
      console.error('Request Error:', error); // Log any request errors
      reject(error);
    });
    req.write(params.toString());
    req.end();
  });
};

//get access token service
const ACCESS_TOKEN_TABLE = 'AccessTokens';
const ACCESS_TOKEN_KEY = 'WhatsAppAccessToken';
const TOKEN_TTL = 10 * 60 * 1000; // 10 minutes in milliseconds

// Function to get the access token, checks if it exists in DynamoDB and is valid
async function getAccessTokenService() {
  // Check if access token exists in DynamoDB
  const tokenData = await getTokenFromDynamoDB();
  
  // Check if token is still valid
  if (tokenData && new Date().getTime() < tokenData.expiryTime) {
    return tokenData.token; // Return cached token
  }

  // If token is expired or not found, fetch a new one
  const newToken = await getAccessToken();

  // Save the new token in DynamoDB with expiryTime
  await saveTokenToDynamoDB(newToken);

  return newToken;
}

// Get access token from DynamoDB
async function getTokenFromDynamoDB() {
    const params = {
      TableName: ACCESS_TOKEN_TABLE,
      Key: { tokenId: ACCESS_TOKEN_KEY },
    };
  
    try {
      const result = await dynamoDbClient.send(new GetCommand(params));
      if (result.Item) {
        const token = result.Item.token;
        const expiryTime = Number(result.Item.expiryTime);
        return { token, expiryTime };
      } else {
        return null;
      }
    } catch (error) {
      console.error('Error getting token from DynamoDB:', error);
      return null;
    }
  }
  
  // Save new access token to DynamoDB
async function saveTokenToDynamoDB(token) {
  const expiryTime = new Date().getTime() + TOKEN_TTL; // Current time + TTL

  const params = {
    TableName: ACCESS_TOKEN_TABLE,
    Item: {
      tokenId: ACCESS_TOKEN_KEY,   // Correct string type for key
      token: token,                // Correct string type for token
      expiryTime: expiryTime.toString(),  // Convert expiry time to string
    },
  };

  try {
    await dynamoDbClient.send(new PutCommand(params));
    console.log("Saved new token to DynamoDB.");
  } catch (error) {
    console.error('Error saving token to DynamoDB:', error);
  }
}

// Function to create a WhatsAppMessage record in Salesforce
async function createWhatsAppMessages(recordData) {
    const instanceUrl = process.env.SF_INSTANCE_URL;

    const tokenData = await getAccessTokenService();
    const accessToken = tokenData.access_token;
    
    return new Promise((resolve, reject) => {

        const postData = JSON.stringify(recordData);

        const options = {
            hostname: instanceUrl,
            path: '/services/data/v61.0/sobjects/'+process.env.WHATSAPP_MESSAGE_S_OBJ_NAME+'/',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 201) {
                    resolve(JSON.parse(data)); // Successfully created
                } else {
                    reject(new Error(`Error inserting record: ${data}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(new Error(`Error with request: ${error.message}`));
        });

        req.write(postData);
        req.end();
    });
}
