# User Guide (License Manager)

This guide is for the License Manager who issues keys to customers.

## Workflow

1.  **Customer Purchase**: A customer buys a RheoLab corporate license.
2.  **Generate Key**:
    - Login to the Admin Panel.
    - Click **"Создать лицензию"**.
    - Enter customer name.
    - Select `Corporate`, `Developer`, or `Superuser` based on the issuance scenario.
    - Click **Create**.
    - Copy the generated key (e.g., `ABCD-1234-EFGH-5678`).
3.  **Send Key**: Email the key to the customer.
4.  **Activation**:
    - The customer enters the key in the RheoLab app.
    - The app connects to this server and activates.
    - You will see the status change to "Active" and the Machine ID appear in the panel.

## Common Tasks

### Extending a License
If a customer renews their subscription:
1.  Find their license in the list.
2.  Click the **Edit** (pencil) icon.
3.  Change the **Expiration Date** to the new date (e.g., add 1 year).
4.  Click **Save**.
The customer's app will automatically pick up the new date on the next validation check. They do *not* need to re-enter the key.

### Moving a License (Computer Change)
If a customer buys a new PC or reinstalls Windows:
1.  They cannot activate the same key on a new PC because it is locked to the old Machine ID.
2.  **Procedure**:
    - Verify it's the same customer.
    - Try the admin-panel reset-binding action first.
    - Issue a new key only if business rules or activation limits require it.

### Handling Trials
- Issue a "Trial" license.
- It will expire automatically in 30 days.
- If they decide to buy:
    1.  Find the trial license.
    2.  Edit it.
    3.  Change **Type** to the required tier (`Corporate`, `Developer`, or `Superuser`).
    4.  Update **Expiration Date**.
    5.  Save.
    The customer continues using the same key.
