import orderModel from './../models/orderModel.js';
import userModel from './../models/userModel.js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * placeOrder
 * - Expects authMiddleware to set req.body.userId (your middleware does this).
 * - Accepts req.body.paymentMethod = 'stripe' | 'cod' | 'none' (default 'stripe').
 * - For 'stripe' returns { success:true, session_url }.
 * - For 'cod'/'none' returns { success:true, order } (no payment required).
 */
const placeOrder = async (req, res) => {
  const frontend_url = process.env.FRONTEND_URL || 'http://localhost:5173';

  try {
    // Prefer userId from auth middleware; fallback to body (compatibility)
    const userId = req.body.userId || req.userId || (req.user && (req.user.id || req.user._id));
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized: userId missing' });

    const { items, amount, address, paymentMethod = 'stripe' } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    // Normalize and validate item prices & quantities (do not trust client)
    const normalizedItems = items.map((it) => {
      const priceNum = Number(it.price);
      const quantityNum = Number(it.quantity) || 1;

      if (Number.isNaN(priceNum) || priceNum < 0) {
        throw new Error(`Invalid price for item ${it.name || it._id}`);
      }

      return {
        _id: it._id,
        name: it.name,
        price: priceNum,
        quantity: quantityNum,
        // keep other fields if needed (e.g. image)
        ...(it.image ? { image: it.image } : {})
      };
    });

    // Create order with payment=false initially
    const newOrder = new orderModel({
      userId,
      items: normalizedItems,
      amount,
      address,
      payment: false,
      paymentMethod,
      status: paymentMethod === 'stripe' ? 'awaiting_payment' : 'pending',
      createdAt: new Date()
    });

    await newOrder.save();

    // Clear user's cart (ensure your user model field name matches)
    try {
      await userModel.findByIdAndUpdate(userId, { cartData: {} });
    } catch (err) {
      // Non-fatal: log but continue — order was created
      console.error('Failed to clear user cart:', err);
    }

    // If no online payment requested, return order right away
    if (paymentMethod === 'cod' || paymentMethod === 'none') {
      return res.status(201).json({ success: true, order: newOrder, message: 'Order placed (no online payment required).' });
    }

    // Build Stripe line_items
    const line_items = normalizedItems.map((item) => ({
      price_data: {
        currency: 'lkr',
        product_data: { name: item.name || 'Item' },
        unit_amount: Math.round(item.price * 100) // convert LKR to paise (smallest unit)
      },
      quantity: item.quantity
    }));

    // Add delivery fee (example: 80 LKR). Change as needed.
    const DELIVERY_FEE = Number(process.env.DELIVERY_FEE) || 80;
    if (DELIVERY_FEE > 0) {
      line_items.push({
        price_data: {
          currency: 'lkr',
          product_data: { name: 'Delivery Charges' },
          unit_amount: Math.round(DELIVERY_FEE * 100)
        },
        quantity: 1
      });
    }

    // Create stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: `${frontend_url}/verify?success=true&orderId=${newOrder._id}`,
      cancel_url: `${frontend_url}/verify?success=false&orderId=${newOrder._id}`,
      metadata: {
        orderId: String(newOrder._id)
      }
    });

    // Save stripe session id for later verification / webhook cross-check
    await orderModel.findByIdAndUpdate(newOrder._id, { stripeSessionId: session.id });

    if (!session.url) {
      console.error('Stripe session created but session.url missing:', session);
      return res.status(500).json({ success: false, message: 'Failed to create Stripe checkout session' });
    }

    return res.status(200).json({ success: true, session_url: session.url });
  } catch (error) {
    console.error('placeOrder error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal Server Error' });
  }
};

/**
 * verifyOrder
 * - Lightweight endpoint if your frontend uses the ?success=... redirect flow.
 * - For robust verification prefer Stripe Webhooks (below).
 * - Expects { orderId, success } in req.body (success may be 'true'|'false' or boolean).
 */
const verifyOrder = async (req, res) => {
  const { orderId, success } = req.body;
  try {
    if (!orderId) return res.status(400).json({ success: false, message: 'orderId required' });

    if (success === 'true' || success === true) {
      await orderModel.findByIdAndUpdate(orderId, { payment: true, status: 'confirmed' });
      return res.json({ success: true, message: 'Paid' });
    } else {
      // Mark cancelled (or delete if you prefer)
      await orderModel.findByIdAndUpdate(orderId, { status: 'cancelled' });
      return res.json({ success: false, message: 'Not Paid' });
    }
  } catch (error) {
    console.error('verifyOrder error:', error);
    return res.status(500).json({ success: false, message: 'Error' });
  }
};

/**
 * Stripe webhook handler (recommended)
 * - Configure your Stripe webhook endpoint to point to this route.
 * - IMPORTANT: In Express, mount this route with raw body parser:
 *   app.post('/api/order/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
 * - Set STRIPE_WEBHOOK_SECRET in env (from your Stripe dashboard).
 */
const stripeWebhookHandler = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    if (!webhookSecret) {
      // If webhook secret is not set, try to parse body directly (less secure) — only for dev.
      event = req.body;
    } else {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata && session.metadata.orderId;
    try {
      if (orderId) {
        await orderModel.findByIdAndUpdate(orderId, { payment: true, status: 'confirmed' });
        console.log(`Order ${orderId} marked as paid via webhook.`);
      } else if (session.id) {
        // fallback: find order by stripeSessionId
        const order = await orderModel.findOne({ stripeSessionId: session.id });
        if (order) {
          await orderModel.findByIdAndUpdate(order._id, { payment: true, status: 'confirmed' });
          console.log(`Order ${order._id} marked as paid via webhook (found by session id).`);
        } else {
          console.warn('Webhook: checkout.session.completed received but no matching order found.');
        }
      }
    } catch (err) {
      console.error('Error updating order on webhook:', err);
      return res.status(500).send();
    }
  }

  // Return 200 to acknowledge receipt of the event
  res.json({ received: true });
};

/**
 * userOrders - return orders for the logged-in user
 * - authMiddleware sets req.body.userId
 */
const userOrders = async (req, res) => {
  try {
    const userId = req.body.userId || req.userId || (req.user && (req.user.id || req.user._id));
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const orders = await orderModel.find({ userId }).sort({ createdAt: -1 });
    return res.json({ success: true, data: orders });
  } catch (error) {
    console.error('userOrders error:', error);
    return res.status(500).json({ success: false, message: 'Error fetching orders' });
  }
};

/**
 * listOrders - admin listing of all orders
 * - You should protect this route with an admin check in your middleware.
 */
const listOrders = async (req, res) => {
  try {
    const orders = await orderModel.find({}).sort({ createdAt: -1 });
    return res.json({ success: true, data: orders });
  } catch (error) {
    console.error('listOrders error:', error);
    return res.status(500).json({ success: false, message: 'Error' });
  }
};

/**
 * updateStatus - admin endpoint to update order status
 * - Expects { orderId, status } in req.body
 */
const updateStatus = async (req, res) => {
  try {
    const { orderId, status } = req.body;
    if (!orderId || !status) return res.status(400).json({ success: false, message: 'orderId and status required' });

    await orderModel.findByIdAndUpdate(orderId, { status });
    return res.json({ success: true, message: 'Status Updated' });
  } catch (error) {
    console.error('updateStatus error:', error);
    return res.status(500).json({ success: false, message: 'Error' });
  }
};

export {
  placeOrder,
  verifyOrder,
  stripeWebhookHandler,
  userOrders,
  listOrders,
  updateStatus
};



// import orderModel from './../models/orderModel.js';
// import userModel from './../models/userModel.js';
// import Stripe from "stripe"

// const stripe =  new Stripe(process.env.STRIPE_SECRET_KEY)

// // Placing user order for frontend
// const placeOrder = async (req, res) =>{

//     const frontend_url = 'http://localhost:5173';
//     try {
//         const newOrder = new orderModel({
//             userId: req.body.userId,
//             items: req.body.items,
//             amount:req.body.amount,
//             address: req.body.address
//         })

//         await newOrder.save();
//         await userModel.findByIdAndUpdate(req.body.userId,{cartData:{}});

//         const line_items = req.body.items.map((item)=>({
//             price_data :{
//                 currency: "lkr",
//                 product_data:{
//                     name: item.name
//                 },
//                 unit_amount:item.price*100*300
//             },
//             quantity: item.quantity
//         }))

//         line_items.push({
//             price_data :{
//                 currency:"lkr",
//                 product_data:{
//                     name:"Delivery Charges"
//                 },
//                 unit_amount:2*100*80
//             },
//             quantity:1
//         })

//         const session = await stripe.checkout.sessions.create({
//             line_items:line_items,
//             mode:'payment',
//             success_url:`${frontend_url}/verify?success=true&orderId=${newOrder._id}`,
//             cancel_url:`${frontend_url}/verify?success=false&orderId=${newOrder._id}`
//         })

//         res.json({success:true, session_url:session.url})
//     } catch (error) {
//         console.log(error)
//         res.json({success:false, message:"Error"})
//     }
// }

// const verifyOrder = async (req, res) =>{
//     const {orderId, success} = req.body;
//     try {
//         if(success=='true'){
//             await orderModel.findByIdAndUpdate(orderId,{payment:true});
//             res.json({success:true, message:"Paid"})
//         }else{
//             await orderModel.findByIdAndDelete(orderId);
//             res.json({success:false, message:"Not Paid"})
//         }
//     } catch (error) {
//         console.log(error)
//         res.json({success:false, message:"Error"})
//     }
// }

// // user orders for frontend
// const userOrders = async (req,res) => {
//     try {
//         const orders = await orderModel.find({userId:req.body.userId})
//         res.json({success:true, data:orders})
//     } catch (error) {
//         console.log(error)
//         res.json({success:false, message:"Error"})
//     }
// }

// // listing orders for admin panel
// const listOrders = async (req,res) =>{
//    try {
//     const orders = await orderModel.find({});
//     res.json({success:true, data:orders})
//    } catch (error) {
//         console.log(error)
//         res.json({success:false, message:"Error"})  
//    } 
// }

// // api for updating order status
// const updateStatus = async (req, res) =>{
//     try {
//         await orderModel.findByIdAndUpdate(req.body.orderId,{status:req.body.status})
//         res.json({success:true, message:"Status Updated"})
//     } catch (error) {
//         console.log(error)
//         res.json({success:false, message:"Error"})  
//     }
// }

// export {placeOrder, verifyOrder, userOrders,listOrders, updateStatus}