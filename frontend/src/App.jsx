import { useEffect, useState } from "react";
import "./App.css";

const API = "https://smm-panel-production-6c8e.up.railway.app";

function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [active, setActive] = useState("Dashboard");

  const [services, setServices] = useState([]);
  const [orders, setOrders] = useState([]);
  const [adminOrders, setAdminOrders] = useState([]);
  const [orderFilter, setOrderFilter] = useState("All");
  const [balance, setBalance] = useState(0);
  const [deposits, setDeposits] = useState([]);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMethod, setDepositMethod] = useState("Easypaisa");
  const [transactionId, setTransactionId] = useState("");

  useEffect(() => {
    fetch(`${API}/api/services`)
      .then((res) => res.json())
      .then((data) => setServices(data))
      .catch((err) => console.log("Services error:", err));

    fetch(`${API}/api/orders`)
      .then((res) => res.json())
      .then((data) => setOrders(data))
      .catch((err) => console.log("Orders error:", err));

    fetch(`${API}/api/balance`)
      .then((res) => res.json())
      .then((data) => setBalance(data.balance))
      .catch((err) => console.log("Balance error:", err));
  }, []);

  useEffect(() => {
    if ((active === "Admin" || active === "Dashboard")) {
      fetch(`${API}/api/admin/orders`)
        .then((res) => res.json())
        .then((data) => setAdminOrders(data))
        .catch((err) => console.log("Admin orders error:", err));

      fetch(`${API}/api/admin/deposits`)
        .then((res) => res.json())
        .then((data) => setDeposits(data))
        .catch((err) => console.log("Admin deposits error:", err));
    }
  }, [active]);

  const revenue = adminOrders.reduce((total, order) => {
    const service = services.find((s) => s.id === order.serviceId);
    const price = service ? Number(service.price) : 0;
    return total + (price * Number(order.quantity)) / 1000;
  }, 0);

  const submitDeposit = async () => {
    const amount = Number(depositAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Please enter a valid amount");
      return;
    }

    try {
      const response = await fetch(`${API}/api/deposits`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          method: depositMethod,
          amount: amount,
          transactionId: transactionId.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Deposit request failed");
        return;
      }

      alert(`Deposit request #${data.depositId} submitted successfully`);
      setDepositAmount("");
      setTransactionId("");

      fetch(`${API}/api/admin/deposits`)
        .then((res) => res.json())
        .then((data) => setDeposits(data))
        .catch((err) => console.log("Deposit history error:", err));
    } catch (error) {
      console.log("Deposit error:", error);
      alert("Backend connection error");
    }
  };

  const placeOrder = async (service) => {
    const link = prompt("Enter your social media link:");
    if (!link) return;

    const quantity = prompt("Enter quantity:", "100");
    if (!quantity) return;

    try {
      const response = await fetch(`${API}/api/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          serviceId: service.id,
          link: link,
          quantity: Number(quantity),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Order failed");
        return;
      }

      setOrders((old) => [...old, data.order]);
      setBalance(data.balance);

      alert("Order placed successfully!");
      setActive("Orders");
    } catch (error) {
      console.log("Order error:", error);
      alert("Backend connection failed");
    }
  };

  const updateDepositStatus = async (depositId, status) => {
    try {
      const response = await fetch(`${API}/api/admin/deposits/${depositId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Deposit update failed");
        return;
      }

      setDeposits((old) =>
        old.map((item) =>
          item.id === depositId ? data.deposit : item
        )
      );

      setBalance(Number(data.balance));
      alert(`Deposit ${status.toLowerCase()} successfully`);
    } catch (error) {
      console.log("Deposit status error:", error);
      alert("Backend connection failed");
    }
  };

  const refreshAdminOrders = () => {
    fetch(`${API}/api/admin/orders`)
      .then((res) => res.json())
      .then((data) => setAdminOrders(data))
      .catch((err) => console.log("Admin orders error:", err));

    fetch(`${API}/api/admin/deposits`)
      .then((res) => res.json())
      .then((data) => setDeposits(data))
      .catch((err) => console.log("Admin deposits error:", err));
  };

  const [authMode, setAuthMode] = useState("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  const handleAuth = async (event) => {
    event.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    try {
      const endpoint =
        authMode === "login"
          ? `${API}/api/login`
          : `${API}/api/register`;

      const body =
        authMode === "login"
          ? {
              email: authEmail.trim(),
              password: authPassword,
            }
          : {
              name: authName.trim(),
              email: authEmail.trim(),
              password: authPassword,
            };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        setAuthError(data.error || "Authentication failed");
        return;
      }

      setCurrentUser(data.user);
      setLoggedIn(true);
      setAuthName("");
      setAuthEmail("");
      setAuthPassword("");
    } catch (error) {
      console.log("Authentication error:", error);
      setAuthError("Backend connection failed");
    } finally {
      setAuthLoading(false);
    }
  };

  if (!loggedIn) {
    return (
      <div className="login-page">
        <div className="login-box">
          <h1>Rooh Ul Islam SMM</h1>
          <p>Social Media Marketing Panel</p>

          <div className="auth-tabs">
            <button
              type="button"
              onClick={() => {
                setAuthMode("login");
                setAuthError("");
              }}
            >
              Login
            </button>

            <button
              type="button"
              onClick={() => {
                setAuthMode("register");
                setAuthError("");
              }}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleAuth}>
            {authMode === "register" && (
              <input
                type="text"
                placeholder="Full Name"
                value={authName}
                onChange={(e) => setAuthName(e.target.value)}
                required
              />
            )}

            <input
              type="email"
              placeholder="Email Address"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              required
            />

            <input
              type="password"
              placeholder="Password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              minLength="8"
              required
            />

            {authError && (
              <p className="auth-error">{authError}</p>
            )}

            <button type="submit" disabled={authLoading}>
              {authLoading
                ? "Please wait..."
                : authMode === "login"
                ? "Login"
                : "Create Account"}
            </button>
          </form>

          <small>
            {authMode === "login"
              ? "Login with your registered account"
              : "Create your SMM panel account"}
          </small>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h2>Rooh Ul Islam SMM</h2>

        <button onClick={() => setActive("Dashboard")}>
          🏠 Dashboard
        </button>

        <button onClick={() => setActive("Services")}>
          📦 Services
        </button>

        <button onClick={() => setActive("Orders")}>
          🛒 Orders
        </button>

        <button onClick={() => setActive("Balance")}>
          💰 Balance
        </button>

        <button onClick={() => setActive("Admin")}>
          👑 Admin Panel
        </button>

        <button
          className="logout"
          onClick={() => setLoggedIn(false)}
        >
          🚪 Logout
        </button>
      </aside>

      <main className="content">
        <header>
          <h1>{active}</h1>
          <span>Balance: ₨{balance.toFixed(2)}</span>
        </header>

        {active === "Dashboard" && (
          <>
            <div className="panel dashboard-welcome">
              <h2>👋 Welcome to Rooh Ul Islam SMM</h2>
              <p>Manage orders, services, deposits and your complete SMM business from one dashboard.</p>
            </div>

            <div className="cards">
              <div className="card">
                <h3>💰 Available Balance</h3>
                <strong>₨{balance.toFixed(2)}</strong>
              </div>

              <div className="card">
                <h3>📦 Total Orders</h3>
                <strong>{adminOrders.length}</strong>
              </div>

              <div className="card">
                <h3>💵 Total Revenue</h3>
                <strong>₨{revenue.toFixed(2)}</strong>
              </div>

              <div className="card">
                <h3>💎 Total Profit</h3>
                <strong>₨{adminOrders.reduce((total, order) => total + Number(order.profit || 0), 0).toFixed(2)}</strong>
              </div>
            </div>

            <div className="dashboard-status">
              <div className="status-card">
                <span>⚙️ Active Services</span>
                <strong>{services.length}</strong>
              </div>

              <div className="status-card">
                <span>⏳ Pending Orders</span>
                <strong>{adminOrders.filter(o => o.status === "Pending").length}</strong>
              </div>

              <div className="status-card">
                <span>🔄 Processing Orders</span>
                <strong>{adminOrders.filter(o => o.status === "Processing").length}</strong>
              </div>

              <div className="status-card">
                <span>✅ Completed Orders</span>
                <strong>{adminOrders.filter(o => o.status === "Completed").length}</strong>
              </div>

              <div className="status-card">
                <span>❌ Cancelled Orders</span>
                <strong>{adminOrders.filter(o => o.status === "Cancelled").length}</strong>
              </div>

              <div className="status-card">
                <span>💳 Pending Deposits</span>
                <strong>{deposits.filter(d => d.status === "Pending").length}</strong>
              </div>
            </div>

            <div className="panel">
              <h2>💳 Deposit Overview</h2>
              <p>Total deposits submitted: <strong>₨{deposits.reduce((total, d) => total + Number(d.amount || 0), 0).toFixed(2)}</strong></p>
              <p>Pending deposit requests: <strong>{deposits.filter(d => d.status === "Pending").length}</strong></p>
            </div>
          </>
        )}
        {active === "Balance" && (
          <div>
            <div className="panel">
              <h2>💰 My Balance</h2>
              <div className="balance-display">
                <span>Available Balance</span>
                <strong>₨{Number(balance).toFixed(2)}</strong>
              </div>
            </div>

            <div className="panel">
              <h2>💳 Add Balance</h2>
              <p>Send payment using one of the methods below, then submit your transaction details.</p>

              <div className="payment-methods">
                <div className="payment-card">
                  <h3>💚 Easypaisa</h3>
                  <p><strong>Account Name:</strong> SMM Panel</p>
                  <p><strong>Account Number:</strong> 03XX-XXXXXXX</p>
                  
                </div>

                <div className="payment-card">
                  <h3>🔵 JazzCash</h3>
                  <p><strong>Account Name:</strong> SMM Panel</p>
                  <p><strong>Account Number:</strong> 03XX-XXXXXXX</p>
                  
                </div>

                <div className="payment-card">
                  <h3>🏦 Bank Account</h3>
                  <p><strong>Bank:</strong> Your Bank Name</p>
                  <p><strong>Account Title:</strong> SMM Panel</p>
                  <p><strong>Account Number:</strong> XXXX-XXXXXXX</p>
                  <p><strong>IBAN:</strong> PKXX XXXX XXXX XXXX</p>
                </div>
              </div>

              <div style={{ marginTop: "25px" }}>
                <label>Payment Method</label>
                <select
                  value={depositMethod}
                  onChange={(e) => setDepositMethod(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: "8px",
                    marginBottom: "15px",
                    padding: "10px",
                  }}
                >
                  <option value="Easypaisa">Easypaisa</option>
                  <option value="JazzCash">JazzCash</option>
                  <option value="Bank Account">Bank Account</option>
                </select>

                <label>Amount (₨)</label>
                <input
                  type="number"
                  min="1"
                  placeholder="Enter deposit amount"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: "8px",
                    marginBottom: "15px",
                    padding: "10px",
                    boxSizing: "border-box",
                  }}
                />

                <label>Transaction ID / Reference Number</label>
                <input
                  type="text"
                  placeholder="Enter transaction ID or reference number"
                  value={transactionId}
                  onChange={(e) => setTransactionId(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: "8px",
                    marginBottom: "15px",
                    padding: "10px",
                    boxSizing: "border-box",
                  }}
                />

                <button onClick={submitDeposit}>
                  💳 Submit Deposit Request
                </button>
              </div>
            </div>

            <div className="panel">
              <h2>📋 Deposit History</h2>

              {deposits.length === 0 ? (
                <p>No deposit requests yet.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="admin-table deposit-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Method</th>
                        <th>Amount</th>
                        <th>Transaction ID</th>
                        <th>Status</th>
                        <th>Date</th>
                      </tr>
                    </thead>

                    <tbody>
                      {deposits.map((deposit) => (
                        <tr key={deposit.id}>
                          <td>#{deposit.id}</td>
                          <td>{deposit.method}</td>
                          <td>
                            ₨{Number(deposit.amount).toFixed(2)}
                          </td>
                          <td>
                            {deposit.transactionId || "-"}
                          </td>
                          <td>
                            {deposit.status === "Approved" ? (
                              <span>🟢 Approved</span>
                            ) : deposit.status === "Rejected" ? (
                              <span>🔴 Rejected</span>
                            ) : (
                              <span>🟡 Pending</span>
                            )}
                          </td>
                          <td>
                            {deposit.createdAt
                              ? new Date(deposit.createdAt).toLocaleString()
                              : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {active === "Orders" && (
          <div className="panel">
            <div className="admin-header">
              <div>
                <h2>🛒 My Orders</h2>
                <p>View all your orders and their current status.</p>
              </div>
              <strong>₨{balance.toFixed(2)}</strong>
            </div>

            {orders.length === 0 ? (
              <p>No orders found.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Service</th>
                      <th>Link</th>
                      <th>Quantity</th>
                      <th>Status</th>
                      <th>Created</th>
                    </tr>
                  </thead>

                  <tbody>
                    {orders.map((order) => {
                      const service = services.find(
                        (s) => s.id === order.serviceId
                      );

                      return (
                        <tr key={order.id}>
                          <td>#{order.id}</td>
                          <td>{service ? service.name : `Service #${order.serviceId}`}</td>
                          <td>
                            <a
                              href={order.link}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {order.link}
                            </a>
                          </td>
                          <td>{order.quantity}</td>
                          <td>
                            <strong>{order.status}</strong>
                          </td>
                          <td>
                            {order.createdAt
                              ? new Date(order.createdAt).toLocaleString()
                              : "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {active === "Services" && (
          <div className="panel">
            <h2>Available Services</h2>
            {services.length === 0 ? (
              <p>Loading services...</p>
            ) : (
              services.map((service) => (
                <div className="service" key={service.id}>
                  <div>
                    <h3>{service.name}</h3>
                    <p>Category: {service.category}</p>
                    <p>Price: ₨{service.price}</p>
                    <p>Status: {service.status}</p>
                  </div>
                  <button onClick={() => placeOrder(service)}>
                    Order Now
                  </button>
                </div>
              ))
            )}
          </div>
        )}
        {active === "Admin" && (
          <>
            <div className="panel">
              <div className="admin-header">
                <div>
                  <h2>Admin Orders</h2>
                  <p>All orders from the database</p>
                </div>

                <button className="admin-refresh" onClick={refreshAdminOrders}>
                  🔄 Refresh Orders
                </button>
              </div>

              <div className="cards admin-stats">
                <div className="card">
                  <h3>📦 Total Orders</h3>
                  <strong>{adminOrders.length}</strong>
                  <p>All orders</p>
                </div>

                <div className="card">
                  <h3>⏳ Pending</h3>
                  <strong>{adminOrders.filter((o) => o.status === "Pending").length}</strong>
                  <p>Waiting for processing</p>
                </div>

                <div className="card">
                  <h3>🔄 Processing</h3>
                  <strong>{adminOrders.filter((o) => o.status === "Processing").length}</strong>
                  <p>Currently processing</p>
                </div>

                <div className="card">
                  <h3>✅ Completed</h3>
                  <strong>{adminOrders.filter((o) => o.status === "Completed").length}</strong>
                  <p>Successfully completed</p>
                </div>

                <div className="card">
                  <h3>❌ Cancelled</h3>
                  <strong>{adminOrders.filter((o) => o.status === "Cancelled").length}</strong>
                  <p>Cancelled orders</p>
                </div>

                <div className="card">
                  <h3>💰 Balance</h3>
                  <strong>₨{balance.toFixed(2)}</strong>
                  <p>Available balance</p>
                </div>

                <div className="card">
                  <h3>💵 Revenue</h3>
                  <strong>₨{revenue.toFixed(2)}</strong>
                  <p>Order revenue</p>
                </div>

                <div className="card">
                  <h3>💳 Deposits</h3>
                  <strong>₨{deposits.reduce((sum, d) => sum + Number(d.amount || 0), 0).toFixed(2)}</strong>
                  <p>Total deposits</p>
                </div>
              </div>

              <div className="admin-filters">
                {["All", "Pending", "Processing", "Completed", "Cancelled"].map(
                  (filter) => (
                    <button
                      key={filter}
                      onClick={() => setOrderFilter(filter)}
                    >
                      {filter}
                    </button>
                  )
                )}
              </div>

              {adminOrders.length === 0 ? (
                <p>No orders found.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Service</th>
                        <th>Link</th>
                        <th>Quantity</th>
                        <th>Status</th>
                        <th>Created</th>
                      </tr>
                    </thead>

                    <tbody>
                      {adminOrders
                        .filter(
                          (order) =>
                            orderFilter === "All" ||
                            order.status === orderFilter
                        )
                        .map((order) => (
                          <tr key={order.id}>
                            <td>#{order.id}</td>
                            <td>{order.serviceId}</td>
                            <td>{order.link}</td>
                            <td>{order.quantity}</td>
                            <td>
                              <select
                                value={order.status}
                                onChange={async (e) => {
                                  const newStatus = e.target.value;

                                  try {
                                    const response = await fetch(
                                      `${API}/api/admin/orders/${order.id}/status`,
                                      {
                                        method: "PATCH",
                                        headers: {
                                          "Content-Type": "application/json",
                                        },
                                        body: JSON.stringify({
                                          status: newStatus,
                                        }),
                                      }
                                    );

                                    const data = await response.json();

                                    if (!response.ok) {
                                      throw new Error(
                                        data.error || "Status update failed"
                                      );
                                    }

                                    setAdminOrders((old) =>
                                      old.map((item) =>
                                        item.id === order.id
                                          ? data.order
                                          : item
                                      )
                                    );
                                  } catch (err) {
                                    console.log(
                                      "Status update error:",
                                      err
                                    );
                                    alert("Status update failed");
                                  }
                                }}
                              >
                                <option value="Pending">Pending</option>
                                <option value="Processing">Processing</option>
                                <option value="Completed">Completed</option>
                                <option value="Cancelled">Cancelled</option>
                              </select>
                            </td>
                            <td>
                              {new Date(
                                order.createdAt
                              ).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          <div className="panel" style={{ marginTop: "25px" }}>
            <h2>💳 Deposit Requests</h2>
            <p>Manage customer deposit requests</p>

            {deposits.length === 0 ? (
              <p>No deposit requests found.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Method</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deposits.map((deposit) => (
                      <tr key={deposit.id}>
                        <td>#{deposit.id}</td>
                        <td>{deposit.method}</td>
                        <td>₨{Number(deposit.amount).toFixed(2)}</td>
                        <td>{deposit.status}</td>
                        <td>{new Date(deposit.createdAt).toLocaleString()}</td>
                        <td>
                          {deposit.status === "Pending" ? (
                            <>
                              <button onClick={() => updateDepositStatus(deposit.id, "Approved")}>
                                ✅ Approve
                              </button>
                              <button onClick={() => updateDepositStatus(deposit.id, "Rejected")} style={{ marginLeft: "6px" }}>
                                ❌ Reject
                              </button>
                            </>
                          ) : (
                            deposit.status
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          </>
        )}
      </main>
    </div>
  );
}

export default App;
