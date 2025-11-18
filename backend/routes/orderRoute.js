import express from "express";
import authMiddleware from './../middleware/auth.js';
import { placeOrder, markOrderPaid, userOrders, listOrders, updateStatus } from "../controllers/orderController.js";

const orderRouter = express.Router();

orderRouter.post("/place", authMiddleware, placeOrder);
// optional: route to mark paid later if you want
orderRouter.post("/mark-paid", authMiddleware, markOrderPaid);

orderRouter.post("/userorders", authMiddleware, userOrders);
orderRouter.get('/list', listOrders);
orderRouter.post('/status', updateStatus);

export default orderRouter;


// import express from "express"
// import authMiddleware from './../middleware/auth.js';
// import { placeOrder, verifyOrder, userOrders,listOrders,updateStatus } from "../controllers/orderController.js";

// const orderRouter = express.Router();

// orderRouter.post("/place",authMiddleware,placeOrder);
// orderRouter.post("/verify", verifyOrder)
// orderRouter.post("/userorders",authMiddleware,userOrders)
// orderRouter.get('/list',listOrders)
// orderRouter.post('/status', updateStatus)

// export default orderRouter;

