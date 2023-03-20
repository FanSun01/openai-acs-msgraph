import pkg from 'express';
import pgPkg from 'pg';
import { OpenAIApi, Configuration } from 'openai';
import dotenv from 'dotenv';
import { CommunicationIdentityClient } from '@azure/communication-identity';
import { SmsClient } from '@azure/communication-sms';
import { initializeDb } from './initDatabase.mjs';
const { Router } = pkg;
const { Pool } = pgPkg;

dotenv.config();

const pool = new Pool({
    user: process.env.POSTGRES_USER,
    host: 'localhost',
    database: 'CustomersDB',
    password: process.env.POSTGRES_PASSWORD,
    port: 5432,
});

const router = Router();

initializeDb().catch(err => console.error(err));

router.get('/customers', async (req, res) => {
    try {
        const results = await pool.query('SELECT * FROM get_customers()');
        if (results && results.rows) {
            res.json(results.rows);
        }
        else {
            res.json([]);
        }
    }
    catch (error) {
        console.error('Error retrieving customers:', error);
        res.status(500).json({ error: 'Error retrieving customers.' });
    }
});

router.get('/acstoken', async (req, res) => {
    const connectionString = process.env.ACS_CONNECTION_STRING;
    let tokenClient = new CommunicationIdentityClient(connectionString);
    const user = await tokenClient.createUser();
    const userToken = await tokenClient.getToken(user, ["voip"]);
    res.json({ userId: user.communicationUserId, ...userToken });
});

async function generateSQLQuery(userQuery) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    if (!OPENAI_API_KEY) {
        throw new Error('Missing OpenAI API key in environment variables.');
    }

    try {
        const prompt =
            `### Postgres SQL tables, with their properties:
         #
         # customers (id, company, city, email)
         # orders (id, customer_id, date, total)
         # order_items (id, order_id, product_id, quantity, price)
         # reviews (id, customer_id, review, date, comment)
         #
         ### ${userQuery}
         #
         # Only allow SELECT queries. UPDATE, INSERT, DELETE are not allowed.
         # Convert any strings to a Postgresql parameterized query value to avoid SQL injection attacks

         Return a JSON object with the SQL query and the parameter values in it. 
         Example: { "sql": "", "paramValues": [] }
        `;

        const configuration = new Configuration({
            apiKey: process.env.OPENAI_API_KEY
        });
        const openai = new OpenAIApi(configuration);
        const completion = await openai.createChatCompletion({
            model: 'gpt-4', // gpt-3.5-turbo
            max_tokens: 1024,
            temperature: 0,
            messages: [{ role: 'user', content: prompt }]
        });
        const sqlCommandObject = completion.data.choices[0].message.content.trim();
        console.log(sqlCommandObject);
        return sqlCommandObject;
    } catch (error) {
        console.error('Error generating SQL query:', error);
        throw error;
    }
}

router.post('/sendsms', async (req, res) => {
    const message = req.body.message;
    const toPhone = req.body.toPhone;

    if (!message || !toPhone) {
        return res.status(400).json({  
            status: false,
            message: 'Message and toPhone must be provided!'
        });
    }

    try {
        const connectionString = process.env.ACS_CONNECTION_STRING;
        const smsClient = new SmsClient(connectionString);
    
        const sendResults = await smsClient.send({
            from: process.env.ACS_PHONE_NUMBER,
            to: [toPhone],
            message: message
        });
        res.json({
            status: sendResults[0].successful,
            messageId: sendResults[0].messageId,
            message: ''
        });
    }
    catch (e) {
        res.status(500).json({
            status: false,
            messageId: '',
            message: e.message
        });
    }
});

router.post('/generatesql', async (req, res) => {
    const userQuery = req.body.query; // 'Get the total revenue for all orders';

    if (!userQuery) {
        return res.status(400).json({ error: 'Missing parameter "query".' });
    }

    try {
        const sqlCommandObject = await generateSQLQuery(userQuery);
        let result = [];
        if (sqlCommandObject) {
            result = await queryDb(JSON.parse(sqlCommandObject));
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Error generating SQL query.' });
    }
});

async function queryDb(sqlCommandObject) {
    if (!sqlCommandObject) {
        return { error: 'Missing SQL command object.' };
    }

    try {
        const result = await pool.query(sqlCommandObject.sql, sqlCommandObject.paramValues);

        // Check if the result has rows or an object literal, and handle accordingly
        if (!result.rows) {
            return [];
        }

        if (Array.isArray(result.rows)) {
            return result.rows;
        }

        if (typeof result.rows === 'object') {
            return [result.rows];
        }
    }
    catch (error) {
        console.error('Error executing query:', error);
        res.status(500).json({ error: 'Error executing query.' });
    }
}

export default router;